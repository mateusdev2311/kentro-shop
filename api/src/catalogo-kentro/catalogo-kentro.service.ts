import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { produtoDoSdk } from '../conectores/kentro/kentro.conector';
import { CatalogoLocal, CatalogoSincronizado } from '../conectores/nucleo/conector';
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

/** Linhas por INSERT na troca da cópia (o Postgres aceita até 65535 parâmetros por comando). */
const LINHAS_POR_INSERT = 1000;

export interface EstadoCatalogoKentro {
  sincronizadoEm: Date | null;
  total: number;
  categorias: number;
  sincronizando: boolean;
  /** Só na sincronização feita pela API: por que a última falhou (a cópia anterior continua valendo). */
  ultimoErro: string | null;
  ultimoErroEm: Date | null;
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
      ultimoErro: c?.ultimoErro ?? null,
      ultimoErroEm: c?.ultimoErroEm ?? null,
    };
  }

  /**
   * Sincronização feita pela API (ex.: banco de dados do ERP): pega a trava da loja antes de ler a fonte.
   * A trava é um UPDATE condicional, então duas instâncias da API não leem o banco da loja ao mesmo tempo.
   */
  async travar(lojaId: string): Promise<string> {
    const lote = `b${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
    const agora = new Date();
    await this.prisma.catalogoKentro.upsert({ where: { lojaId }, create: { lojaId }, update: {} });
    const { count } = await this.prisma.catalogoKentro.updateMany({
      where: {
        lojaId,
        OR: [{ loteAtual: null }, { loteAtividadeEm: null }, { loteAtividadeEm: { lt: new Date(agora.getTime() - TRAVA_MS) } }],
      },
      data: { loteAtual: lote, loteAtividadeEm: agora },
    });
    if (!count) throw new ErroApi(409, 'SINCRONIZANDO', 'Já há uma sincronização do catálogo em andamento. Tente de novo em instantes.');
    return lote;
  }

  /**
   * Troca a cópia inteira pelo que veio da fonte, numa transação: quem lê o catálogo nunca vê a cópia pela metade.
   * Nada veio (com produtos antes) é recusado sempre; a automática também recusa perder mais da metade,
   * que costuma ser falha na fonte e não o catálogo de verdade (a manual aceita: alguém pediu e está olhando).
   */
  async trocar(lojaId: string, lote: string, catalogo: CatalogoSincronizado, { automatica }: { automatica: boolean }): Promise<{ total: number; sincronizadoEm: Date }> {
    const porId = new Map(catalogo.produtos.map((p) => [p.produto.id, p]));
    const produtos = [...porId.values()];
    const usados = new Set(produtos.flatMap((p) => p.produto.categoriaIds));
    const grupos = catalogo.categorias.filter((c) => usados.has(c.id));
    const agora = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        const atual = await tx.catalogoKentro.findUnique({ where: { lojaId } });
        if (atual?.loteAtual !== lote) throw new ErroApi(409, 'LOTE_ENCERRADO', 'A sincronização foi interrompida. Tente de novo.');
        const anterior = atual.total;
        if (!produtos.length && anterior > 0) {
          throw new ErroApi(409, 'CATALOGO_VAZIO', 'A sincronização não trouxe nenhum produto. A cópia anterior foi mantida.');
        }
        if (automatica && anterior > 0 && produtos.length < anterior / 2) {
          throw new ErroApi(
            409,
            'CATALOGO_ENCOLHEU',
            `A sincronização automática trouxe ${produtos.length} produtos (antes eram ${anterior}) e foi ignorada. Se o catálogo diminuiu mesmo, clique em "Sincronizar agora".`,
          );
        }
        await tx.produtoKentro.deleteMany({ where: { lojaId } });
        for (let i = 0; i < produtos.length; i += LINHAS_POR_INSERT) {
          await tx.produtoKentro.createMany({
            data: produtos.slice(i, i + LINHAS_POR_INSERT).map(({ produto: p, termos }) => ({
              lojaId,
              id: p.id,
              nome: p.nome,
              sku: p.sku,
              busca: paraBusca(`${p.nome} ${p.sku}${termos ? ` ${termos}` : ''}`),
              grupos: p.categoriaIds,
              dados: p as unknown as Prisma.InputJsonValue,
              lote,
            })),
          });
        }
        await tx.catalogoKentro.update({
          where: { lojaId },
          data: {
            grupos: grupos as unknown as Prisma.InputJsonValue,
            total: produtos.length,
            sincronizadoEm: agora,
            loteAtual: null,
            loteAtividadeEm: null,
            ultimoErro: null,
            ultimoErroEm: null,
          },
        });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return { total: produtos.length, sincronizadoEm: agora };
  }

  /** A sincronização da API falhou: solta a trava e guarda o motivo. A cópia anterior continua valendo. */
  async falhou(lojaId: string, lote: string, mensagem: string): Promise<void> {
    await this.prisma.catalogoKentro.updateMany({
      where: { lojaId, loteAtual: lote },
      data: { loteAtual: null, loteAtividadeEm: null, ultimoErro: mensagem.slice(0, 300), ultimoErroEm: new Date() },
    });
  }

  /** A loja trocou de plataforma: a cópia da plataforma anterior não pode aparecer como catálogo da nova. */
  async apagar(lojaId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.produtoKentro.deleteMany({ where: { lojaId } }),
      this.prisma.catalogoKentro.deleteMany({ where: { lojaId } }),
    ]);
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
