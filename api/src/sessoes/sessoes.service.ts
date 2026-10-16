import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Sessao as SessaoBanco } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { calcularTotais, resumoDoPedido } from './calculo';
import { Checkout, Cliente, EventoPublico, ItemPublico, SessaoCompleta, SessaoPublica, StatusSessao, Totais } from './tipos';

const MAX_EVENTOS = 30;
const ABERTOS: StatusSessao[] = ['link_enviado', 'navegando'];
const MENSAGEM_LINK_INVALIDO = 'Este link não está mais disponível. Peça um novo link no WhatsApp.';

export const linkInvalido = () => new ErroApi(404, 'LINK_INVALIDO', MENSAGEM_LINK_INVALIDO);

export type Autor = EventoPublico['autor'];

@Injectable()
export class SessoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configLoja: ConfigLojaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /** Link do atendimento: reaproveita a sessão aberta do chat ou cria outra (a anterior foi finalizada ou expirou). */
  async criarOuReaproveitar(lojaId: string, dados: { chatId: string; nome?: string; telefone?: string }): Promise<SessaoCompleta> {
    const aberta = await this.prisma.sessao.findFirst({
      where: { lojaId, chatId: dados.chatId, status: { in: ABERTOS }, expiraEm: { gt: new Date() } },
      orderBy: { criadaEm: 'desc' },
    });
    if (aberta) {
      const cliente = aberta.cliente as unknown as Cliente;
      const atualizado: Cliente = { nome: dados.nome?.trim() || cliente.nome, telefone: dados.telefone?.trim() || cliente.telefone };
      await this.prisma.sessao.update({ where: { id: aberta.id }, data: { cliente: atualizado as unknown as Prisma.InputJsonValue } });
      return this.completa(aberta.id);
    }

    const { expiracaoLinkDias } = await this.configLoja.obter(lojaId);
    const cliente: Cliente = { nome: dados.nome?.trim() ?? '', telefone: dados.telefone?.trim() ?? '' };
    const criada = await this.prisma.sessao.create({
      data: {
        lojaId,
        token: randomBytes(24).toString('base64url'),
        chatId: dados.chatId,
        cliente: cliente as unknown as Prisma.InputJsonValue,
        totais: calcularTotais([], null) as unknown as Prisma.InputJsonValue,
        expiraEm: new Date(Date.now() + expiracaoLinkDias * 86_400_000),
        eventos: { create: { tipo: 'link', texto: 'Link do catálogo gerado', autor: 'atendente' } },
      },
    });
    return this.completa(criada.id);
  }

  /** Sessão pelo token do link. Inexistente, expirada ou de loja bloqueada → LINK_INVALIDO. */
  async porToken(token: string): Promise<SessaoBanco> {
    const sessao = await this.prisma.sessao.findUnique({ where: { token }, include: { loja: { select: { status: true } } } });
    if (!sessao || sessao.loja.status === 'bloqueada') throw linkInvalido();
    const encerrada = sessao.status === 'finalizado' || sessao.status === 'pedido_criado';
    if (!encerrada && (sessao.status === 'expirado' || sessao.expiraEm.getTime() < Date.now())) throw linkInvalido();
    const { loja: _loja, ...semLoja } = sessao;
    return semLoja;
  }

  async porChat(lojaId: string, chatId: string): Promise<SessaoCompleta | null> {
    const sessao = await this.prisma.sessao.findFirst({ where: { lojaId, chatId }, orderBy: { criadaEm: 'desc' } });
    return sessao ? this.completa(sessao.id) : null;
  }

  /** O cliente abriu a página do catálogo. */
  async abrir(token: string): Promise<SessaoPublica> {
    const sessao = await this.porToken(token);
    if (sessao.status === 'link_enviado') {
      const mudou = await this.prisma.sessao.updateMany({
        where: { id: sessao.id, status: 'link_enviado' },
        data: { status: 'navegando', abertaEm: new Date() },
      });
      if (mudou.count) await this.registrar(sessao.id, 'abriu', 'Cliente abriu o catálogo', 'cliente');
    }
    return this.publica(sessao.id);
  }

  async registrar(sessaoId: string, tipo: string, texto: string, autor: Autor, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.eventoSessao.create({ data: { sessaoId, tipo, texto, autor } });
  }

  async completa(sessaoId: string): Promise<SessaoCompleta> {
    const s = await this.prisma.sessao.findUniqueOrThrow({
      where: { id: sessaoId },
      include: { itens: { orderBy: { revalidadoEm: 'asc' } }, eventos: { orderBy: { em: 'desc' }, take: MAX_EVENTOS } },
    });
    const itens: ItemPublico[] = s.itens.map((i) => {
      const precoUnitario = Number(i.precoUnitario);
      return {
        produtoId: i.produtoId,
        variacaoId: i.variacaoId || null,
        sku: i.sku,
        nome: i.nome,
        variacaoNome: i.variacaoNome,
        imagem: i.imagem,
        unidade: i.unidade,
        precoUnitario,
        quantidade: i.quantidade,
        subtotal: Math.round(precoUnitario * i.quantidade * 100) / 100,
        m2: i.m2,
      };
    });
    const cliente = s.cliente as unknown as Cliente;
    const checkout = (s.checkout as unknown as Checkout | null) ?? null;
    const totais = s.totais as unknown as Totais;
    return {
      id: s.id,
      status: s.status,
      url: `${this.config.urlPublica}/c/${s.token}`,
      cliente,
      itens,
      totais,
      checkout,
      eventos: s.eventos.map((e) => ({ em: e.em.toISOString(), texto: e.texto, autor: e.autor })),
      resumo: resumoDoPedido({ cliente, checkout, itens, totais }),
      abertaEm: s.abertaEm?.toISOString() ?? null,
      finalizadaEm: s.finalizadaEm?.toISOString() ?? null,
      expiraEm: s.expiraEm.toISOString(),
    };
  }

  async publica(sessaoId: string): Promise<SessaoPublica> {
    const { eventos: _eventos, resumo: _resumo, ...publica } = await this.completa(sessaoId);
    return publica;
  }
}
