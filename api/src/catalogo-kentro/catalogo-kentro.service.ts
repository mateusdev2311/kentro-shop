import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { produtoDoSdk } from '../conectores/kentro/kentro.conector';
import { CatalogoLocal } from '../conectores/nucleo/conector';
import { Categoria, Produto } from '../contratos/modelo';
import { Papel } from '../lojas/lojas.service';
import { LoteCatalogoKentroDto } from './dto';

/** Sem parte nova por este tempo, a sincronização em andamento é considerada abandonada. */
export const TRAVA_MS = 2 * 60_000;

/** Nome e SKU sem acento e em minúsculas: a busca casa "piso" com "Pisô" e "PISO". */
export const paraBusca = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export interface EstadoCatalogoKentro {
  sincronizadoEm: Date | null;
  total: number;
  categorias: number;
  sincronizando: boolean;
}

const gruposDe = (v: Prisma.JsonValue | undefined): Categoria[] =>
  (Array.isArray(v) ? v : []).flatMap((g) => {
    const o = g && typeof g === 'object' && !Array.isArray(g) ? g : null;
    return o && o.id != null && o.nome != null ? [{ id: String(o.id), nome: String(o.nome) }] : [];
  });

/**
 * Cópia do catálogo da Kentro. A extensão lê os produtos com omni.products.list e envia em lotes
 * (partes de até 250); na última parte a cópia anterior é trocada pela nova. Uma sincronização por vez.
 */
@Injectable()
export class CatalogoKentroService {
  constructor(private readonly prisma: PrismaService) {}

  /** Leitura da cópia, no formato que o conector da Kentro usa. */
  leitor(lojaId: string): CatalogoLocal {
    const prisma = this.prisma;
    return {
      async estado() {
        const c = await prisma.catalogoKentro.findUnique({ where: { lojaId }, select: { sincronizadoEm: true, total: true } });
        return { sincronizadoEm: c?.sincronizadoEm ?? null, total: c?.total ?? 0 };
      },
      async categorias() {
        const c = await prisma.catalogoKentro.findUnique({ where: { lojaId }, select: { grupos: true } });
        return gruposDe(c?.grupos);
      },
      async produtos(filtro) {
        const termo = paraBusca(filtro.busca?.trim() ?? '').slice(0, 100);
        const where: Prisma.ProdutoKentroWhereInput = {
          lojaId,
          ...(termo ? { busca: { contains: termo } } : {}),
          ...(filtro.categoriaId ? { grupos: { has: filtro.categoriaId } } : {}),
        };
        const pular = (filtro.pagina - 1) * filtro.porPagina;
        const [linhas, total] = await prisma.$transaction([
          prisma.produtoKentro.findMany({ where, orderBy: [{ nome: 'asc' }, { id: 'asc' }], skip: pular, take: filtro.porPagina, select: { dados: true } }),
          prisma.produtoKentro.count({ where }),
        ]);
        return {
          itens: linhas.map((l) => l.dados as unknown as Produto),
          pagina: filtro.pagina,
          porPagina: filtro.porPagina,
          total,
          temMais: pular + linhas.length < total,
        };
      },
      async produto(id) {
        if (!id) return null;
        const linha =
          (await prisma.produtoKentro.findUnique({ where: { lojaId_id: { lojaId, id } }, select: { dados: true } })) ??
          (await prisma.produtoKentro.findFirst({ where: { lojaId, sku: id }, select: { dados: true } }));
        return linha ? (linha.dados as unknown as Produto) : null;
      },
    };
  }

  async estado(lojaId: string): Promise<EstadoCatalogoKentro> {
    const c = await this.prisma.catalogoKentro.findUnique({ where: { lojaId } });
    return {
      sincronizadoEm: c?.sincronizadoEm ?? null,
      total: c?.total ?? 0,
      categorias: gruposDe(c?.grupos).length,
      sincronizando: !!c?.loteAtual && !!c.loteAtividadeEm && Date.now() - c.loteAtividadeEm.getTime() < TRAVA_MS,
    };
  }

  async receberLote(
    lojaId: string,
    papel: Papel,
    lote: LoteCatalogoKentroDto,
  ): Promise<{ recebidos: number } | { recebidos: number; total: number; sincronizadoEm: Date }> {
    const integracao = await this.prisma.integracao.findUnique({ where: { lojaId }, select: { plataforma: true } });
    if (integracao?.plataforma !== 'kentro') {
      throw new ErroApi(409, 'PLATAFORMA_DIFERENTE', 'Esta loja não usa o catálogo da Kentro. Escolha "Catálogo da Kentro" na integração e salve.');
    }

    const agora = new Date();
    const atual = await this.prisma.catalogoKentro.findUnique({ where: { lojaId } });
    if (lote.parte === 0) {
      const outraEmAndamento =
        !!atual?.loteAtual &&
        atual.loteAtual !== lote.lote &&
        !!atual.loteAtividadeEm &&
        agora.getTime() - atual.loteAtividadeEm.getTime() < TRAVA_MS;
      if (outraEmAndamento) throw new ErroApi(409, 'SINCRONIZANDO', 'Já há uma sincronização do catálogo em andamento. Tente de novo em instantes.');
      await this.prisma.catalogoKentro.upsert({
        where: { lojaId },
        create: { lojaId, loteAtual: lote.lote, loteAtividadeEm: agora },
        update: { loteAtual: lote.lote, loteAtividadeEm: agora },
      });
    } else if (atual?.loteAtual !== lote.lote) {
      throw new ErroApi(409, 'LOTE_ENCERRADO', 'A sincronização foi interrompida. Comece de novo.');
    }

    // Repetido na mesma parte: vale o último.
    const porId = new Map<string, Produto>();
    for (const bruto of lote.produtos) {
      const p = produtoDoSdk(bruto);
      if (p) porId.set(p.id, p);
    }
    const produtos = [...porId.values()];
    await this.prisma.$transaction([
      this.prisma.produtoKentro.deleteMany({ where: { lojaId, id: { in: produtos.map((p) => p.id) } } }),
      this.prisma.produtoKentro.createMany({
        data: produtos.map((p) => ({
          lojaId,
          id: p.id,
          nome: p.nome,
          sku: p.sku,
          busca: paraBusca(`${p.nome} ${p.sku}`),
          grupos: p.categoriaIds,
          dados: p as unknown as Prisma.InputJsonValue,
          lote: lote.lote,
        })),
      }),
      this.prisma.catalogoKentro.update({ where: { lojaId }, data: { loteAtividadeEm: agora } }),
    ]);
    if (!lote.ultima) return { recebidos: produtos.length };

    const total = await this.prisma.produtoKentro.count({ where: { lojaId, lote: lote.lote } });
    const anterior = atual?.total ?? 0;
    // O atendente pode enxergar menos produtos que o admin: a sincronização dele não apaga o que sumiu.
    if (papel !== 'admin' && anterior > 0 && total < anterior / 2) {
      await this.prisma.catalogoKentro.update({ where: { lojaId }, data: { loteAtual: null, loteAtividadeEm: null } });
      throw new ErroApi(
        409,
        'CATALOGO_ENCOLHEU',
        'A sincronização trouxe bem menos produtos que a anterior e foi ignorada. Peça ao administrador para sincronizar pela tela do Kentro Shop — Admin.',
      );
    }

    const usados = new Set((await this.prisma.produtoKentro.findMany({ where: { lojaId, lote: lote.lote }, select: { grupos: true } })).flatMap((l) => l.grupos));
    // Sem nomes nesta sincronização (a Kentro não os deu), ficam os da anterior.
    const recebidos: Categoria[] = lote.grupos
      ? lote.grupos.map((g) => ({ id: String(g.id ?? '').trim(), nome: String(g.nome ?? '').trim().slice(0, 80) })).filter((g) => g.id && g.nome)
      : gruposDe(atual?.grupos);
    const grupos = recebidos.filter((g) => usados.has(g.id));

    await this.prisma.$transaction([
      this.prisma.produtoKentro.deleteMany({ where: { lojaId, lote: { not: lote.lote } } }),
      this.prisma.catalogoKentro.update({
        where: { lojaId },
        data: { grupos: grupos as unknown as Prisma.InputJsonValue, total, sincronizadoEm: agora, loteAtual: null, loteAtividadeEm: null },
      }),
    ]);
    return { recebidos: produtos.length, total, sincronizadoEm: agora };
  }
}
