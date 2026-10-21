import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Sessao as SessaoBanco } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { calcularTotais, resumoDoPedido } from './calculo';
import { Checkout, Cliente, EnderecoContato, EventoPublico, FiltroLink, ItemPublico, PedidoNaLoja, SessaoCompleta, SessaoPublica, StatusSessao, Totais } from './tipos';

const MAX_EVENTOS = 30;
/** Links ativos do mesmo carrinho: o atual mais os anteriores. */
export const MAX_LINKS = 5;

/** A vitrine de um link: um link anterior do carrinho tem filtro e preços próprios. */
export type VistaDoLink = Pick<SessaoBanco, 'token' | 'filtro' | 'restrito' | 'mostrarPrecos'>;
const ABERTOS: StatusSessao[] = ['link_enviado', 'navegando'];
const MENSAGEM_LINK_INVALIDO = 'Este link não está mais disponível. Peça um novo link no WhatsApp.';

export const linkInvalido = () => new ErroApi(404, 'LINK_INVALIDO', MENSAGEM_LINK_INVALIDO);

export type Autor = EventoPublico['autor'];

/** O que o painel (ou a IA) sabe do contato ao gerar o link. */
export interface DadosDoContato {
  chatId: string;
  nome?: string;
  telefone?: string;
  email?: string;
  documento?: string;
  endereco?: EnderecoContato;
}

export interface OpcoesDoLink {
  filtro?: FiltroLink;
  restrito?: boolean;
  mostrarPrecos?: boolean;
}

/** Filtro sem campos vazios; nada sobrando = sem filtro. */
export function limparFiltro(f: FiltroLink): FiltroLink | null {
  const limpo: FiltroLink = {};
  if (f.categoriaId?.trim()) limpo.categoriaId = f.categoriaId.trim();
  if (f.busca?.trim()) limpo.busca = f.busca.trim();
  const ids = [...new Set((f.produtoIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (ids.length) limpo.produtoIds = ids;
  return Object.keys(limpo).length ? limpo : null;
}

function textoDoLink(autor: 'atendente' | 'ia', atendente: string): string {
  if (autor === 'ia') return 'Link do catálogo gerado pela assistente de IA';
  return atendente ? `Link do catálogo gerado por ${atendente}` : 'Link do catálogo gerado';
}

const CAMPOS_ENDERECO =['cep', 'estado', 'cidade', 'bairro', 'rua', 'numero', 'complemento'] as const;

/** Campo vazio não apaga o que já se sabe; um endereço novo (com algum campo) substitui o anterior inteiro. */
export function mesclarCliente(atual: Cliente, dados: Omit<DadosDoContato, 'chatId'>): Cliente {
  const texto = (v?: string) => v?.trim() || undefined;
  const resultado: Cliente = {
    nome: texto(dados.nome) ?? atual.nome ?? '',
    telefone: texto(dados.telefone) ?? atual.telefone ?? '',
  };
  const email = texto(dados.email) ?? atual.email;
  const documento = texto(dados.documento) ?? atual.documento;
  if (email) resultado.email = email;
  if (documento) resultado.documento = documento;
  const novo: EnderecoContato = {};
  for (const campo of CAMPOS_ENDERECO) {
    const valor = texto(dados.endereco?.[campo]);
    if (valor) novo[campo] = campo === 'estado' ? valor.toUpperCase() : valor;
  }
  const endereco = Object.keys(novo).length ? novo : atual.endereco;
  if (endereco) resultado.endereco = endereco;
  return resultado;
}

@Injectable()
export class SessoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configLoja: ConfigLojaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /**
   * Link do atendimento: reaproveita a sessão aberta do chat ou cria outra (a anterior foi finalizada ou expirou).
   * Link montado (filtro, preços ou carrinho pronto) é sempre um link novo, mas do MESMO carrinho: o link atual passa
   * para o histórico e continua valendo (até MAX_LINKS no total), cada um com a sua vitrine. novoCarrinho = descarta o
   * carrinho aberto e começa outro (o comportamento de antes).
   */
  async criarOuReaproveitar(
    lojaId: string,
    dados: DadosDoContato,
    atendente = '',
    montado: OpcoesDoLink | null = null,
    autor: 'atendente' | 'ia' = 'atendente',
    novoCarrinho = false,
  ): Promise<{ sessao: SessaoCompleta; linkNovo: boolean }> {
    const aberta = await this.prisma.sessao.findFirst({
      where: { lojaId, chatId: dados.chatId, status: { in: ABERTOS }, expiraEm: { gt: new Date() } },
      orderBy: { criadaEm: 'desc' },
    });
    if (aberta && novoCarrinho) {
      await this.prisma.sessao.updateMany({ where: { lojaId, chatId: dados.chatId, status: { in: ABERTOS } }, data: { status: 'expirado' } });
    } else if (aberta && montado) {
      await this.novoLinkDoCarrinho(aberta, dados, montado, textoDoLink(autor, atendente), autor);
      return { sessao: await this.completa(aberta.id), linkNovo: true };
    } else if (aberta) {
      const atualizado = mesclarCliente(aberta.cliente as unknown as Cliente, dados);
      await this.prisma.sessao.update({ where: { id: aberta.id }, data: { cliente: atualizado as unknown as Prisma.InputJsonValue } });
      return { sessao: await this.completa(aberta.id), linkNovo: false };
    }

    const { expiracaoLinkDias } = await this.configLoja.obter(lojaId);
    // O link novo herda o que já se sabia do contato no link anterior.
    const cliente = mesclarCliente(aberta ? (aberta.cliente as unknown as Cliente) : { nome: '', telefone: '' }, dados);
    const filtro = montado?.filtro && limparFiltro(montado.filtro);
    const criada = await this.prisma.sessao.create({
      data: {
        lojaId,
        token: randomBytes(24).toString('base64url'),
        chatId: dados.chatId,
        cliente: cliente as unknown as Prisma.InputJsonValue,
        totais: calcularTotais([], null) as unknown as Prisma.InputJsonValue,
        expiraEm: new Date(Date.now() + expiracaoLinkDias * 86_400_000),
        ...(filtro ? { filtro: filtro as unknown as Prisma.InputJsonValue } : {}),
        restrito: montado?.restrito ?? true,
        mostrarPrecos: montado?.mostrarPrecos ?? null,
        eventos: { create: { tipo: 'link', texto: textoDoLink(autor, atendente), autor } },
      },
    });
    return { sessao: await this.completa(criada.id), linkNovo: true };
  }

  /** O link atual vai para o histórico (os mais antigos além de MAX_LINKS deixam de valer) e o novo assume. */
  private async novoLinkDoCarrinho(aberta: SessaoBanco, dados: DadosDoContato, montado: OpcoesDoLink, texto: string, autor: Autor): Promise<void> {
    const filtro = montado.filtro && limparFiltro(montado.filtro);
    const cliente = mesclarCliente(aberta.cliente as unknown as Cliente, dados);
    await this.prisma.$transaction(async (tx) => {
      await tx.linkSessao.create({
        data: {
          sessaoId: aberta.id,
          token: aberta.token,
          ...(aberta.filtro ? { filtro: aberta.filtro as Prisma.InputJsonValue } : {}),
          restrito: aberta.restrito,
          mostrarPrecos: aberta.mostrarPrecos,
        },
      });
      const antigos = await tx.linkSessao.findMany({ where: { sessaoId: aberta.id }, orderBy: { criadoEm: 'desc' }, skip: MAX_LINKS - 1, select: { id: true } });
      if (antigos.length) await tx.linkSessao.deleteMany({ where: { id: { in: antigos.map((l) => l.id) } } });
      await tx.sessao.update({
        where: { id: aberta.id },
        data: {
          token: randomBytes(24).toString('base64url'),
          filtro: filtro ? (filtro as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          restrito: montado.restrito ?? true,
          mostrarPrecos: montado.mostrarPrecos ?? null,
          cliente: cliente as unknown as Prisma.InputJsonValue,
        },
      });
      await this.registrar(aberta.id, 'link', `${texto} (o carrinho continua o mesmo)`, autor, tx);
    });
  }

  /**
   * Sessão pelo token do link (o atual ou um anterior do mesmo carrinho). Um link anterior traz a vitrine DELE:
   * token, filtro, restrito e mostrarPrecos. Inexistente, expirada ou de loja bloqueada → LINK_INVALIDO.
   */
  async porToken(token: string): Promise<SessaoBanco> {
    const incluir = { loja: { select: { status: true } } } as const;
    let sessao = await this.prisma.sessao.findUnique({ where: { token }, include: incluir });
    if (!sessao) {
      const link = await this.prisma.linkSessao.findUnique({ where: { token }, include: { sessao: { include: incluir } } });
      if (link) sessao = { ...link.sessao, token: link.token, filtro: link.filtro, restrito: link.restrito, mostrarPrecos: link.mostrarPrecos };
    }
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

  async chatDaSessao(sessaoId: string): Promise<string | null> {
    const s = await this.prisma.sessao.findUnique({ where: { id: sessaoId }, select: { chatId: true } });
    return s?.chatId ?? null;
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
    return this.publica(sessao.id, sessao);
  }

  async registrar(sessaoId: string, tipo: string, texto: string, autor: Autor, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.eventoSessao.create({ data: { sessaoId, tipo, texto, autor } });
  }

  /** vista = o link pelo qual o cliente entrou (um anterior traz a vitrine dele); omitida = o link atual. */
  async completa(sessaoId: string, vista?: VistaDoLink): Promise<SessaoCompleta> {
    const lida = await this.prisma.sessao.findUniqueOrThrow({
      where: { id: sessaoId },
      include: {
        itens: { orderBy: { revalidadoEm: 'asc' } },
        eventos: { orderBy: { em: 'desc' }, take: MAX_EVENTOS },
        links: { orderBy: { criadoEm: 'desc' } },
      },
    });
    const s = vista ? { ...lida, token: vista.token, filtro: vista.filtro, restrito: vista.restrito, mostrarPrecos: vista.mostrarPrecos } : lida;
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
    const pedido = (s.pedido as unknown as PedidoNaLoja | null) ?? null;
    const resumo = resumoDoPedido({ cliente, checkout, itens, totais });
    return {
      id: s.id,
      status: s.status,
      url: `${this.config.urlPublica}/c/${s.token}`,
      cliente,
      itens,
      totais,
      checkout,
      eventos: s.eventos.map((e) => ({ em: e.em.toISOString(), texto: e.texto, autor: e.autor })),
      resumo: pedido ? `${resumo}\n\nPedido na loja: nº ${pedido.numero}${pedido.url ? `\nLink de pagamento: ${pedido.url}` : ''}` : resumo,
      abertaEm: s.abertaEm?.toISOString() ?? null,
      finalizadaEm: s.finalizadaEm?.toISOString() ?? null,
      expiraEm: s.expiraEm.toISOString(),
      filtro: (s.filtro as unknown as FiltroLink | null) ?? null,
      restrito: s.restrito,
      mostrarPrecos: s.mostrarPrecos,
      pedido,
      // Os outros links que gravam neste mesmo carrinho (sem o atual), do mais novo para o mais antigo.
      linksAnteriores: [{ token: lida.token, filtro: lida.filtro, restrito: lida.restrito }, ...lida.links]
        .filter((l) => l.token !== s.token)
        .map((l) => ({ url: `${this.config.urlPublica}/c/${l.token}`, filtro: (l.filtro as unknown as FiltroLink | null) ?? null, restrito: l.restrito })),
    };
  }

  async publica(sessaoId: string, vista?: VistaDoLink): Promise<SessaoPublica> {
    const { eventos: _eventos, resumo: _resumo, linksAnteriores: _links, ...publica } = await this.completa(sessaoId, vista);
    return publica;
  }
}
