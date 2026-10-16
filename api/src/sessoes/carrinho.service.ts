import { Injectable } from '@nestjs/common';
import { ItemCarrinho, Prisma, Sessao as SessaoBanco } from '@prisma/client';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { NaoEncontrado } from '../conectores/nucleo/erros';
import { Produto } from '../contratos/modelo';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { arredondar, calcularTotais, freteDaRegra, moeda, unidade } from './calculo';
import { FinalizarDto, ItemPedidoDto } from './dto';
import { SessoesService } from './sessoes.service';
import { ClientesService } from './clientes.service';
import { precosVisiveis, sessaoSemPreco } from './sem-preco';
import { Checkout, Cliente, DadosEntrega, FiltroLink, SessaoCompleta, SessaoPublica } from './tipos';

export const MAX_QUANTIDADE = 999;
const MAX_ITENS = 100;

/** Item já revalidado na plataforma, pronto para gravar. */
export interface ItemRevalidado {
  produtoId: string;
  variacaoId: string; // '' = produto simples
  sku: string;
  nome: string;
  variacaoNome: string | null;
  imagem: string | null;
  unidade: string;
  precoUnitario: number;
  quantidade: number;
  m2: number | null;
}

const chave = (produtoId: string, variacaoId: string | null | undefined) => `${produtoId}|${variacaoId ?? ''}`;
const nomeCompleto = (i: { nome: string; variacaoNome: string | null }) => (i.variacaoNome ? `${i.nome} (${i.variacaoNome})` : i.nome);

interface Diferenca {
  sku: string;
  nome: string;
  antes: { preco: number; quantidade: number };
  /** null = saiu do carrinho (indisponível) */
  depois: { preco: number; quantidade: number } | null;
}

const ROTULOS_ENTREGA: Record<string, string> = {
  nome: 'Nome',
  telefone: 'Telefone',
  estado: 'UF',
  cidade: 'Cidade',
  bairro: 'Bairro',
  rua: 'Rua',
  numero: 'Número',
};

const texto = (valor: unknown, max: number) => String(valor ?? '').trim().slice(0, max);

/** Endereço de entrega validado (mesmas regras da demo). */
export function validarEntrega(e: Record<string, unknown> | undefined): DadosEntrega {
  const dados: DadosEntrega = {
    nome: texto(e?.nome, 120),
    telefone: texto(e?.telefone, 30),
    cep: String(e?.cep ?? '').replace(/\D/g, '').slice(0, 8),
    estado: texto(e?.estado, 2).toUpperCase(),
    cidade: texto(e?.cidade, 80),
    bairro: texto(e?.bairro, 80),
    rua: texto(e?.rua, 120),
    numero: texto(e?.numero, 20),
    complemento: texto(e?.complemento, 80),
    referencia: texto(e?.referencia, 160),
  };
  const faltando = Object.keys(ROTULOS_ENTREGA)
    .filter((k) => !dados[k as keyof DadosEntrega])
    .map((k) => ROTULOS_ENTREGA[k]);
  if (dados.cep.length !== 8) faltando.unshift('CEP');
  if (faltando.length) throw new ErroApi(400, 'ENTRADA_INVALIDA', `Preencha: ${faltando.join(', ')}.`);
  dados.cep = `${dados.cep.slice(0, 5)}-${dados.cep.slice(5)}`;
  return dados;
}

/** O produto pertence ao filtro do link? Busca por texto não dá para conferir: vale tudo. */
export function permitidoPeloFiltro(filtro: FiltroLink, produto: Produto): boolean {
  if (filtro.produtoIds?.length) return filtro.produtoIds.includes(produto.id) || filtro.produtoIds.includes(produto.sku);
  if (filtro.categoriaId) return produto.categoriaIds.includes(filtro.categoriaId);
  return true;
}

export const pedidoJaEnviado = () => new ErroApi(409, 'PEDIDO_JA_ENVIADO', 'Seu pedido já foi enviado ao atendente.');

@Injectable()
export class CarrinhoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessoes: SessoesService,
    private readonly catalogo: CatalogoService,
    private readonly configLoja: ConfigLojaService,
    private readonly clientes: ClientesService,
  ) {}

  /** Ações depois da finalização (na 1.4: aviso para a Kentro). Falha numa delas não desfaz o pedido. */
  private readonly aoFinalizar: Array<(sessao: SessaoCompleta) => Promise<void>> = [];

  registrarAoFinalizar(acao: (sessao: SessaoCompleta) => Promise<void>): void {
    this.aoFinalizar.push(acao);
  }

  /**
   * Substitui o carrinho. Preço, nome e estoque vêm sempre da plataforma, nunca do navegador.
   * Só o que mudou é consultado de novo; nada é gravado se a plataforma falhar no meio.
   */
  async definir(token: string, pedidos: ItemPedidoDto[]): Promise<{ sessao: SessaoPublica; avisos: string[] }> {
    const sessao = await this.sessoes.porToken(token);
    const avisos = await this.definirNaSessao(sessao, pedidos, 'cliente');
    return { sessao: await this.sessoes.publica(sessao.id), avisos };
  }

  /** Carrinho pronto ou ajuste feito pelo atendente: não marca o link como aberto e não aplica o filtro do link. */
  async definirPeloAtendente(lojaId: string, sessaoId: string, pedidos: ItemPedidoDto[]): Promise<{ sessao: SessaoCompleta; avisos: string[] }> {
    const sessao = await this.prisma.sessao.findFirst({ where: { id: sessaoId, lojaId } });
    if (!sessao) throw new ErroApi(404, 'SEM_SESSAO', 'Link não encontrado neste atendimento.');
    const avisos = await this.definirNaSessao(sessao, pedidos, 'atendente');
    return { sessao: await this.sessoes.completa(sessao.id), avisos };
  }

  private async definirNaSessao(sessao: SessaoBanco, pedidos: ItemPedidoDto[], autor: 'cliente' | 'atendente'): Promise<string[]> {
    if (sessao.status !== 'link_enviado' && sessao.status !== 'navegando') throw pedidoJaEnviado();
    // Link restrito: o cliente só põe no carrinho o que está no filtro (o que o atendente já pôs continua).
    const filtro = sessao.restrito ? (sessao.filtro as unknown as FiltroLink | null) : null;

    const desejados = new Map<string, { produtoId: string; variacaoId: string; quantidade: number }>();
    for (const p of pedidos) {
      if (p.quantidade <= 0) continue;
      const k = chave(p.produtoId, p.variacaoId);
      const atual = desejados.get(k)?.quantidade ?? 0;
      desejados.set(k, { produtoId: p.produtoId, variacaoId: p.variacaoId ?? '', quantidade: Math.min(atual + p.quantidade, MAX_QUANTIDADE) });
    }
    if (desejados.size > MAX_ITENS) throw new ErroApi(400, 'ENTRADA_INVALIDA', `O carrinho aceita até ${MAX_ITENS} produtos diferentes.`);

    const existentes = await this.prisma.itemCarrinho.findMany({ where: { sessaoId: sessao.id } });
    const porChave = new Map(existentes.map((i) => [chave(i.produtoId, i.variacaoId), i]));
    const avisos: string[] = [];
    const finais: ItemRevalidado[] = [];
    const cache = new Map<string, Promise<Produto | null>>();

    for (const [k, desejado] of desejados) {
      const existente = porChave.get(k);
      if (existente && existente.quantidade === desejado.quantidade) {
        finais.push(daLinha(existente));
        continue;
      }
      if (autor === 'cliente' && filtro && !existente) {
        const produto = await this.carregar(sessao.lojaId, desejado.produtoId, cache);
        if (produto && !permitidoPeloFiltro(filtro, produto)) {
          avisos.push(`${produto.nome} não faz parte desta seleção.`);
          continue;
        }
      }
      const item = await this.revalidarItem(sessao.lojaId, desejado, cache, avisos, existente);
      if (item) finais.push(item);
    }

    await this.gravar(sessao, existentes, finais, autor);
    return avisos;
  }

  /** Produto da plataforma, uma consulta por produto na mesma operação. Inexistente = null. */
  private carregar(lojaId: string, produtoId: string, cache: Map<string, Promise<Produto | null>>): Promise<Produto | null> {
    let promessa = cache.get(produtoId);
    if (!promessa) {
      promessa = this.catalogo.obterProduto(lojaId, produtoId).catch((e: unknown) => {
        if (e instanceof NaoEncontrado) return null;
        throw e;
      });
      cache.set(produtoId, promessa);
    }
    return promessa;
  }

  /** Grava o carrinho revalidado (apaga o que saiu, atualiza o que mudou, totais e atividade) numa transação. */
  private async gravar(
    sessao: { id: string; status: string; abertaEm: Date | null },
    existentes: ItemCarrinho[],
    finais: ItemRevalidado[],
    autor: 'cliente' | 'atendente' | 'sistema',
  ): Promise<void> {
    const porChave = new Map(existentes.map((i) => [chave(i.produtoId, i.variacaoId), i]));
    await this.prisma.$transaction(async (tx) => {
      const ficam = new Set(finais.map((i) => chave(i.produtoId, i.variacaoId)));
      await tx.itemCarrinho.deleteMany({
        where: { sessaoId: sessao.id, id: { in: existentes.filter((e) => !ficam.has(chave(e.produtoId, e.variacaoId))).map((e) => e.id) } },
      });
      for (const item of finais) {
        const anterior = porChave.get(chave(item.produtoId, item.variacaoId));
        if (anterior && anterior.quantidade === item.quantidade && Number(anterior.precoUnitario) === item.precoUnitario) continue;
        await tx.itemCarrinho.upsert({
          where: { sessaoId_produtoId_variacaoId: { sessaoId: sessao.id, produtoId: item.produtoId, variacaoId: item.variacaoId } },
          create: { sessaoId: sessao.id, ...item, revalidadoEm: new Date() },
          update: { ...item, revalidadoEm: new Date() },
        });
      }
      await tx.sessao.update({
        where: { id: sessao.id },
        data: {
          totais: calcularTotais(finais, null) as unknown as Prisma.InputJsonValue,
          // Só o cliente mexendo no carrinho conta como "abriu o link".
          ...(autor === 'cliente' && sessao.status === 'link_enviado' ? { status: 'navegando', abertaEm: sessao.abertaEm ?? new Date() } : {}),
        },
      });
      for (const texto of mudancas(existentes, finais)) {
        await this.sessoes.registrar(sessao.id, 'carrinho', autor === 'atendente' ? `Atendente — ${texto}` : texto, autor, tx);
      }
    });
  }

  /** Cotação do frete pela regra da loja (sem consulta externa nesta fase). */
  async cotarFrete(token: string, cep: string): Promise<{ titulo: string; valor: number | null; prazo?: string }> {
    const sessao = await this.sessoes.porToken(token);
    if (cep.replace(/\D/g, '').length !== 8) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'CEP inválido.');
    const config = await this.configLoja.obter(sessao.lojaId);
    const totais = sessao.totais as unknown as { subtotal?: number } | null;
    return freteDaRegra(config.frete, totais?.subtotal ?? 0);
  }

  /**
   * Finaliza: revalida TODOS os itens. Se preço, estoque ou disponibilidade mudou, grava o carrinho novo e
   * responde 409 PRECOS_ALTERADOS com as diferenças; o cliente confirma finalizando de novo.
   */
  async finalizar(token: string, dto: FinalizarDto): Promise<SessaoPublica> {
    const sessao = await this.sessoes.porToken(token);
    if (sessao.status !== 'link_enviado' && sessao.status !== 'navegando') throw pedidoJaEnviado();
    const config = await this.configLoja.obter(sessao.lojaId);
    const observacoes = texto(dto.observacoes, 500);

    let checkout: Checkout;
    if (dto.tipo === 'entrega') {
      if (!config.entrega.habilitada) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'Esta loja não faz entrega.');
      checkout = { tipo: 'entrega', entrega: validarEntrega(dto.entrega), observacoes };
    } else {
      if (!config.retirada.habilitada) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'Esta loja não faz retirada.');
      const loja = config.lojasRetirada.find((l) => l.id === dto.lojaRetiradaId);
      if (!loja) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'Escolha uma das lojas para retirada.');
      checkout = { tipo: 'retirada', loja, observacoes };
    }

    const existentes = await this.prisma.itemCarrinho.findMany({ where: { sessaoId: sessao.id }, orderBy: { revalidadoEm: 'asc' } });
    if (!existentes.length) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'O carrinho está vazio.');

    const cache = new Map<string, Promise<Produto | null>>();
    const finais: ItemRevalidado[] = [];
    const diferencas: Diferenca[] = [];
    for (const existente of existentes) {
      const antes = daLinha(existente);
      const novo = await this.revalidarItem(sessao.lojaId, antes, cache, [], antes);
      if (novo) finais.push(novo);
      if (!novo || novo.precoUnitario !== antes.precoUnitario || novo.quantidade !== antes.quantidade) {
        diferencas.push({
          sku: antes.sku,
          nome: nomeCompleto(antes),
          antes: { preco: antes.precoUnitario, quantidade: antes.quantidade },
          depois: novo ? { preco: novo.precoUnitario, quantidade: novo.quantidade } : null,
        });
      }
    }

    if (diferencas.length) {
      await this.gravar(sessao, existentes, finais, 'sistema');
      const mostrar = precosVisiveis(sessao, config.mostrarPrecos);
      // Sem preço, o cliente só precisa saber do que ele percebe: quantidade limitada e produto que saiu.
      const visiveis = mostrar
        ? diferencas
        : diferencas
            .filter((d) => !d.depois || d.depois.quantidade !== d.antes.quantidade)
            .map((d) => ({ sku: d.sku, nome: d.nome, antes: { quantidade: d.antes.quantidade }, depois: d.depois && { quantidade: d.depois.quantidade } }));
      if (visiveis.length) {
        const publica = await this.sessoes.publica(sessao.id);
        throw new ErroApi(
          409,
          'PRECOS_ALTERADOS',
          mostrar
            ? 'Alguns preços ou quantidades mudaram desde que você montou o carrinho. Confira e confirme.'
            : 'Alguns itens mudaram desde que você montou o carrinho. Confira e confirme.',
          { diferencas: visiveis, sessao: mostrar ? publica : sessaoSemPreco(publica) },
        );
      }
    }

    const subtotal = calcularTotais(finais, null).subtotal;
    const frete = checkout.tipo === 'entrega' ? freteDaRegra(config.frete, subtotal).valor : 0;
    const totais = calcularTotais(finais, frete);
    // Nome e telefone do checkout valem para o pedido; o resto do pré-cadastro (e-mail, documento) continua.
    const clienteAntes = sessao.cliente as unknown as Cliente;
    const { endereco: _enderecoDoContato, ...semEndereco } = clienteAntes;
    const cliente: Cliente =
      checkout.tipo === 'entrega' ? { ...semEndereco, nome: checkout.entrega.nome, telefone: checkout.entrega.telefone } : clienteAntes;
    await this.prisma.$transaction(async (tx) => {
      await tx.sessao.update({
        where: { id: sessao.id },
        data: {
          status: 'finalizado',
          finalizadaEm: new Date(),
          checkout: checkout as unknown as Prisma.InputJsonValue,
          cliente: cliente as unknown as Prisma.InputJsonValue,
          totais: totais as unknown as Prisma.InputJsonValue,
        },
      });
      await this.sessoes.registrar(sessao.id, 'finalizou', `Cliente finalizou o pedido (${checkout.tipo}) — ${moeda(totais.total)}`, 'cliente', tx);
    });

    const completa = await this.sessoes.completa(sessao.id);
    // Histórico pelo telefone original (o da Kentro); o do checkout só se não houver.
    await this.clientes.registrarFinalizacao(sessao.lojaId, clienteAntes.telefone, completa).catch(() => undefined);
    for (const acao of this.aoFinalizar) await acao(completa).catch(() => undefined);
    const { eventos: _eventos, resumo: _resumo, ...publica } = completa;
    return publica;
  }

  /** Revalida um item na plataforma. Devolve null (com aviso) se não puder ser vendido. */
  async revalidarItem(
    lojaId: string,
    desejado: { produtoId: string; variacaoId: string; quantidade: number },
    cache: Map<string, Promise<Produto | null>>,
    avisos: string[],
    conhecido?: { nome: string; variacaoNome: string | null },
  ): Promise<ItemRevalidado | null> {
    const produto = await this.carregar(lojaId, desejado.produtoId, cache);
    if (!produto) {
      avisos.push(conhecido ? `${nomeCompleto(conhecido)} não está mais disponível.` : 'Um produto do carrinho não está mais disponível.');
      return null;
    }

    let variacao = null;
    if (desejado.variacaoId) {
      variacao = produto.variacoes.find((v) => v.id === desejado.variacaoId) ?? null;
      if (!variacao) {
        avisos.push(`A opção escolhida de ${produto.nome} não existe mais.`);
        return null;
      }
    } else if (produto.variacoes.length) {
      avisos.push(`Escolha a opção de ${produto.nome}.`);
      return null;
    }

    const fonte = variacao ?? produto;
    const nome = { nome: produto.nome, variacaoNome: variacao?.nome ?? null };
    if (!fonte.disponivel || !(fonte.preco > 0)) {
      avisos.push(`${nomeCompleto(nome)} não está mais disponível.`);
      return null;
    }
    let quantidade = desejado.quantidade;
    if (fonte.estoque !== null && quantidade > fonte.estoque) {
      quantidade = Math.max(0, fonte.estoque);
      if (!quantidade) {
        avisos.push(`${nomeCompleto(nome)} não está mais disponível.`);
        return null;
      }
      avisos.push(`Só temos ${quantidade} ${unidade(produto.unidade, quantidade)} de ${nomeCompleto(nome)}.`);
    }
    const m2PorUnidade = produto.regras?.m2PorUnidade;
    return {
      produtoId: desejado.produtoId,
      variacaoId: desejado.variacaoId,
      sku: fonte.sku,
      nome: produto.nome,
      variacaoNome: variacao?.nome ?? null,
      imagem: variacao?.imagem ?? produto.imagens[0] ?? null,
      unidade: produto.unidade,
      precoUnitario: fonte.preco,
      quantidade,
      m2: m2PorUnidade ? arredondar(m2PorUnidade * quantidade) : null,
    };
  }
}

export function daLinha(i: ItemCarrinho): ItemRevalidado {
  return {
    produtoId: i.produtoId,
    variacaoId: i.variacaoId,
    sku: i.sku,
    nome: i.nome,
    variacaoNome: i.variacaoNome,
    imagem: i.imagem,
    unidade: i.unidade,
    precoUnitario: Number(i.precoUnitario),
    quantidade: i.quantidade,
    m2: i.m2,
  };
}

/** Textos da atividade: o que o cliente adicionou, alterou e removeu. */
function mudancas(antes: ItemCarrinho[], depois: ItemRevalidado[]): string[] {
  const anteriores = new Map(antes.map((i) => [chave(i.produtoId, i.variacaoId), i]));
  const textos: string[] = [];
  for (const item of depois) {
    const k = chave(item.produtoId, item.variacaoId);
    const velho = anteriores.get(k);
    if (!velho) textos.push(`Adicionou ${item.quantidade} ${unidade(item.unidade, item.quantidade)} de ${nomeCompleto(item)}`);
    else if (velho.quantidade !== item.quantidade) textos.push(`Alterou ${nomeCompleto(item)}: ${velho.quantidade} → ${item.quantidade}`);
    anteriores.delete(k);
  }
  for (const removido of anteriores.values()) textos.push(`Removeu ${nomeCompleto(removido)}`);
  return textos;
}
