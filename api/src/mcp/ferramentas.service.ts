import { Injectable, Logger } from '@nestjs/common';
import { Loja } from '@prisma/client';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ErroApi } from '../comum/erros';
import { ConfigEfetiva, ConfigLojaService } from '../config-loja/config-loja.service';
import { ErroConector } from '../conectores/nucleo/erros';
import { Categoria, Produto } from '../contratos/modelo';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { moeda, telefoneBr, unidade } from '../sessoes/calculo';
import { CarrinhoService, MAX_QUANTIDADE } from '../sessoes/carrinho.service';
import { ClientesService } from '../sessoes/clientes.service';
import { ItemPedidoDto } from '../sessoes/dto';
import { precosVisiveis } from '../sessoes/sem-preco';
import { SessoesService } from '../sessoes/sessoes.service';
import { FiltroLink, SessaoCompleta } from '../sessoes/tipos';
import { DefinicaoFerramenta, ResultadoFerramenta } from './protocolo';
import { encontrarVariacao, linhasDeVariacoes, mesmaVariacao, opcoesDe, precoUnico } from './variacoes';

// Ferramentas que a assistente de IA da Kentro usa pelo servidor MCP (spec 11.1). A saída é texto enxuto,
// uma linha por fato, para o modelo recomendar sem inventar preço, estoque ou prazo.

const MAX_DESCRICAO = 1500;
const MAX_ITENS_POR_CHAMADA = 50;
const ABERTOS = ['link_enviado', 'navegando'];

/** Erro de uso da ferramenta: a mensagem volta para a IA corrigir a chamada. */
class Recusa extends Error {}

const texto = (v: unknown, max: number): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

function obrigatorio(args: Record<string, unknown>, chave: string, max: number): string {
  const valor = texto(args[chave], max);
  if (!valor) throw new Recusa(`Informe ${chave}.`);
  return valor;
}

function booleano(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function listaDeTextos(v: unknown, max: number): string[] {
  if (v === undefined || v === null || v === '') return [];
  const bruto = Array.isArray(v) ? v : String(v).split(',');
  const lista = [...new Set(bruto.map((x) => texto(x, 100)).filter(Boolean))];
  if (lista.length > max) throw new Recusa(`No máximo ${max} produtos por link.`);
  return lista;
}

/** Item como a IA pediu: a variação vem pelo nome ("Preto / G") ou, de um pedido anterior, pelo id. */
interface ItemPedido {
  produtoId: string;
  variacaoNome?: string;
  variacaoId?: string;
  quantidade: number;
}

/** Itens do carrinho pedidos pela IA. minimo = 0 aceita quantidade zero (remover). */
function itensDe(v: unknown, minimo: 0 | 1): ItemPedido[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Recusa('itens precisa ser uma lista de { produto_id, variacao, quantidade }.');
  if (v.length > MAX_ITENS_POR_CHAMADA) throw new Recusa(`No máximo ${MAX_ITENS_POR_CHAMADA} itens por chamada.`);
  return v.map((bruto, i) => {
    const item = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
    const produtoId = texto(item.produto_id, 100);
    if (!produtoId) throw new Recusa(`Item ${i + 1}: informe produto_id.`);
    const quantidade = Number(item.quantidade ?? 1);
    if (!Number.isInteger(quantidade) || quantidade < minimo || quantidade > MAX_QUANTIDADE) {
      throw new Recusa(`Item ${i + 1}: quantidade precisa ser um número inteiro entre ${minimo} e ${MAX_QUANTIDADE}.`);
    }
    const variacaoNome = texto(item.variacao, 100);
    const variacaoId = texto(item.variacao_id, 100);
    return { produtoId, quantidade, ...(variacaoNome ? { variacaoNome } : {}), ...(variacaoId ? { variacaoId } : {}) };
  });
}

const ESQUEMA_ITENS = {
  type: 'array',
  maxItems: MAX_ITENS_POR_CHAMADA,
  items: {
    type: 'object',
    properties: {
      produto_id: { type: 'string', description: 'produto_id de buscar_produtos.' },
      variacao: {
        type: 'string',
        description: 'Obrigatório quando o produto tem variações: o nome da opção, com cor e tamanho, ex.: "Preto / G". Confira com o cliente antes.',
      },
      variacao_id: { type: 'string', description: 'Só para repetir um item de pedidos_anteriores. Nos demais casos, use variacao.' },
      quantidade: { type: 'integer', minimum: 1, maximum: MAX_QUANTIDADE },
    },
    required: ['produto_id', 'quantidade'],
  },
};

// Texto, não união de tipos: alguns provedores de modelo recusam ["string", "integer"]. Número também é aceito.
const CHAT_ID = { type: 'string', description: 'ID deste atendimento na Kentro (está no contexto da assistente).' };

export const FERRAMENTAS: DefinicaoFerramenta[] = [
  {
    name: 'buscar_produtos',
    title: 'Buscar produtos',
    description:
      'Busca produtos no catálogo da loja, ao vivo (preço, promoção, estoque e variações de agora). Use SEMPRE antes de citar ' +
      'preço, estoque ou disponibilidade. A busca olha só o NOME do produto: cor e tamanho ficam nas opções de cada produto, ' +
      'não no nome. Sem busca e sem categoria, lista o catálogo. Devolve 24 por página.',
    inputSchema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Tipo de peça, modelo ou marca, sem cor e sem tamanho (ex.: "polo", "bermuda sarja", "BSS").' },
        categoria_id: { type: 'string', description: 'id de listar_categorias.' },
        pagina: { type: 'integer', minimum: 1, description: 'Padrão 1.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'detalhes_produto',
    title: 'Detalhes do produto',
    description: 'Ficha completa de um produto: descrição, fotos, todas as variações com preço e estoque, e produtos para comprar junto.',
    inputSchema: {
      type: 'object',
      properties: { produto_id: { type: 'string', description: 'produto_id de buscar_produtos.' } },
      required: ['produto_id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'listar_categorias',
    title: 'Categorias',
    description: 'Categorias do catálogo (id e nome), para buscar por categoria ou gerar um link de uma categoria.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'info_loja',
    title: 'Informações da loja',
    description: 'Regras da loja: entrega e frete, lojas para retirada (endereço e horário), como o pedido é fechado e validade do link.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'gerar_link_catalogo',
    title: 'Gerar link do catálogo',
    description:
      'Gera o link de compra exclusivo deste atendimento, para enviar ao cliente. O link pode ser personalizado: ' +
      'só alguns produtos (produto_ids), uma categoria (categoria_id) ou uma busca, e pode já abrir com o carrinho montado (itens). ' +
      'Sem personalização, reaproveita o link aberto do atendimento. Um link personalizado é sempre novo e o anterior deixa de valer: ' +
      'se o cliente já tem itens no link aberto, prefira adicionar_ao_carrinho.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: CHAT_ID,
        nome: { type: 'string', description: 'Nome do cliente.' },
        telefone: { type: 'string', description: 'Telefone do cliente com DDD.' },
        email: { type: 'string' },
        produto_ids: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Vitrine só com estes produtos.' },
        categoria_id: { type: 'string', description: 'Vitrine só com esta categoria.' },
        busca: { type: 'string', description: 'Vitrine com o resultado desta busca.' },
        restrito: {
          type: 'boolean',
          description: 'Com produto_ids, categoria_id ou busca: true (padrão) = o cliente vê só a seleção; false = a seleção é só a vitrine inicial e o catálogo todo continua aberto.',
        },
        mostrar_precos: { type: 'boolean', description: 'Omitir = segue a loja. false = lista para orçamento, sem valores.' },
        itens: { ...ESQUEMA_ITENS, description: 'Carrinho pronto: o cliente abre o link com estes itens já no carrinho.' },
        substituir_link_aberto: {
          type: 'boolean',
          description: 'Só quando o cliente pediu um link novo: descarta o link aberto que já tem itens no carrinho.',
        },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'adicionar_ao_carrinho',
    title: 'Adicionar ao carrinho',
    description:
      'Soma produtos ao carrinho do link aberto deste atendimento, sem gerar link novo: o cliente continua no mesmo link e não perde ' +
      'o que já escolheu. Quantidade de um item que já está no carrinho é somada.',
    inputSchema: { type: 'object', properties: { chat_id: CHAT_ID, itens: ESQUEMA_ITENS }, required: ['chat_id', 'itens'] },
  },
  {
    name: 'alterar_item_carrinho',
    title: 'Alterar item do carrinho',
    description: 'Muda a quantidade de um item do carrinho do link aberto (0 remove o item). Os outros itens continuam como estão.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: CHAT_ID,
        produto_id: { type: 'string' },
        variacao: { type: 'string', description: 'A opção do item no carrinho, se ele tiver, ex.: "Preto / G".' },
        quantidade: { type: 'integer', minimum: 0, maximum: MAX_QUANTIDADE, description: 'Quantidade nova; 0 remove.' },
      },
      required: ['chat_id', 'produto_id', 'quantidade'],
    },
  },
  {
    name: 'consultar_carrinho',
    title: 'Consultar carrinho',
    description:
      'Situação do link deste atendimento: se o cliente abriu, o que está no carrinho, totais, forma de entrega escolhida, ' +
      'pedido finalizado e link de pagamento (quando a loja cria o pedido).',
    inputSchema: { type: 'object', properties: { chat_id: CHAT_ID }, required: ['chat_id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'pedidos_anteriores',
    title: 'Pedidos anteriores',
    description:
      'Últimos pedidos do cliente nesta loja, pelo telefone DELE (o do atendimento), para oferecer "pedir de novo". ' +
      'Os itens trazem produto_id e variacao_id para montar o carrinho com gerar_link_catalogo.',
    inputSchema: {
      type: 'object',
      properties: { telefone: { type: 'string', description: 'Telefone do cliente deste atendimento, com DDD.' } },
      required: ['telefone'],
    },
    annotations: { readOnlyHint: true },
  },
];

export const INSTRUCOES =
  'Ferramentas do Kentro Shop: catálogo ao vivo da loja e link de compra do atendimento. Busque o produto antes de citar ' +
  'preço ou estoque. Envie ao cliente o link exatamente como a ferramenta devolver. O chat_id é o ID do atendimento da Kentro.';

/** Linha de preço. Loja sem preço visível: nada. */
function preco(p: { preco: number; precoDe?: number }, mostrar: boolean): string {
  if (!mostrar) return '';
  if (!(p.preco > 0)) return 'sem preço cadastrado';
  return p.precoDe && p.precoDe > p.preco ? `${moeda(p.preco)} (de ${moeda(p.precoDe)})` : moeda(p.preco);
}

function estoque(p: { estoque: number | null; disponivel: boolean }): string {
  if (!p.disponivel || p.estoque === 0) return 'esgotado';
  return p.estoque === null ? 'disponível' : `estoque ${p.estoque}`;
}

/** Preço do produto: o das variações quando é um só para todas; variando, cada variação mostra o seu. */
function precoDoProduto(p: Produto, mostrar: boolean): string {
  if (!mostrar) return '';
  if (!p.variacoes.length) return preco(p, mostrar);
  const unico = precoUnico(p);
  return unico ? preco(unico, mostrar) : 'preço varia por opção';
}

/** Como a IA deve nomear a variação no carrinho. */
function comoNomear(p: Produto): string {
  const exemplo = p.variacoes.find((v) => v.disponivel && v.estoque !== 0) ?? p.variacoes[0];
  return `ao montar o carrinho, informe variacao com cor e tamanho (ex.: "${exemplo.nome}")`;
}

function blocoDeVariacoes(p: Produto, mostrar: boolean, recuo: string, max: number): string[] {
  const atributos = p.atributosVariacao?.length ? ` (${p.atributosVariacao.join(', ')})` : '';
  return [`${recuo}Opções${atributos} e estoque — ${comoNomear(p)}:`, ...linhasDeVariacoes(p, mostrar, max).map((l) => recuo + l)];
}

function resumoDoProduto(p: Produto, mostrar: boolean, n: number): string {
  const selo = p.regras?.selo ? ` [${p.regras.selo}]` : '';
  const linhas = [`${n}. ${p.nome}${selo}`];
  const valor = precoDoProduto(p, mostrar);
  const dados = [`produto_id ${p.id}`, valor && `${valor} por ${unidade(p.unidade, 1)}`];
  if (!p.variacoes.length) dados.push(estoque(p));
  linhas.push('   ' + dados.filter(Boolean).join(' · '));
  const curta = (p.descricaoCurta || p.descricao).replace(/\s+/g, ' ').trim();
  if (curta) linhas.push(`   ${curta.length > 140 ? `${curta.slice(0, 137)}…` : curta}`);
  if (p.variacoes.length) linhas.push(...blocoDeVariacoes(p, mostrar, '   ', 40));
  if (p.regras?.m2PorUnidade) linhas.push(`   ${p.regras.m2PorUnidade} m² por ${unidade(p.unidade, 1)}`);
  return linhas.join('\n');
}

function avisoSemPreco(mostrar: boolean): string[] {
  return mostrar ? [] : ['Atenção: esta loja não mostra preços ao cliente. Não informe valores; o atendente passa o orçamento.'];
}

function textoDoFiltro(f: FiltroLink | null, restrito: boolean): string {
  if (!f) return 'catálogo completo';
  const partes = [
    f.produtoIds?.length ? `${f.produtoIds.length} produto(s) escolhido(s)` : '',
    f.categoriaId ? `categoria ${f.categoriaId}` : '',
    f.busca ? `busca "${f.busca}"` : '',
  ].filter(Boolean);
  return `${partes.join(', ')}${restrito ? ' (o cliente vê só essa seleção)' : ' (vitrine inicial; o catálogo todo continua aberto)'}`;
}

const SITUACAO: Record<string, string> = {
  link_enviado: 'link enviado, o cliente ainda não abriu',
  navegando: 'o cliente abriu o link e está escolhendo',
  finalizado: 'o cliente FINALIZOU o pedido',
  pedido_criado: 'o cliente FINALIZOU e o pedido foi criado na loja',
  expirado: 'link expirado',
};

function textoDaSessao(s: SessaoCompleta, mostrar: boolean, opcoes: { eventos?: boolean } = {}): string {
  const expirou = ABERTOS.includes(s.status) && new Date(s.expiraEm).getTime() < Date.now();
  const linhas = [`Situação: ${expirou ? 'link expirado' : SITUACAO[s.status] ?? s.status}`, `Link: ${s.url}`, `Mostra: ${textoDoFiltro(s.filtro, s.restrito)}`];
  if (ABERTOS.includes(s.status) && !expirou) linhas.push(`Válido até: ${new Date(s.expiraEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  if (!s.itens.length) linhas.push('Carrinho: vazio');
  else {
    linhas.push('Carrinho:');
    for (const i of s.itens) {
      const nome = i.variacaoNome ? `${i.nome} (${i.variacaoNome})` : i.nome;
      const valor = mostrar ? ` — ${moeda(i.subtotal)}` : '';
      linhas.push(`- ${i.quantidade} ${unidade(i.unidade, i.quantidade)} de ${nome}${valor} [produto_id ${i.produtoId}]`);
    }
    if (mostrar) {
      linhas.push(`Subtotal: ${moeda(s.totais.subtotal)}`);
      if (s.checkout?.tipo === 'entrega') linhas.push(`Frete: ${s.totais.frete === null ? 'a combinar' : s.totais.frete === 0 ? 'grátis' : moeda(s.totais.frete)}`);
      if (s.checkout) linhas.push(`Total: ${moeda(s.totais.total)}`);
    }
  }
  if (s.checkout?.tipo === 'entrega') {
    const e = s.checkout.entrega;
    linhas.push(`Entrega para ${e.nome}: ${e.rua}, ${e.numero}${e.complemento ? ` (${e.complemento})` : ''} — ${e.bairro}, ${e.cidade}/${e.estado}`);
  } else if (s.checkout?.tipo === 'retirada') {
    linhas.push(`Retirada em: ${s.checkout.loja.nome} — ${s.checkout.loja.endereco}${s.checkout.loja.horario ? ` (${s.checkout.loja.horario})` : ''}`);
  }
  if (s.checkout?.observacoes) linhas.push(`Observações do cliente: ${s.checkout.observacoes}`);
  if (s.pedido) linhas.push(`Pedido na loja: nº ${s.pedido.numero}${s.pedido.url ? ` — link de pagamento: ${s.pedido.url}` : ''}`);
  if (opcoes.eventos && s.eventos.length) {
    linhas.push('Últimas atividades:');
    for (const e of s.eventos.slice(0, 6)) linhas.push(`- ${e.texto}`);
  }
  return [...avisoSemPreco(mostrar), ...linhas].join('\n');
}

const CONFIRA =
  'Antes de responder, confira item por item (produto, cor, tamanho e quantidade) se o carrinho abaixo é o que o cliente pediu. ' +
  'Diga ao cliente só o que está abaixo; se algo não bate, corrija com alterar_item_carrinho.';

function textoDoFrete(c: ConfigEfetiva): string {
  const prazo = c.frete.prazo ? ` Prazo: ${c.frete.prazo}.` : '';
  if (c.frete.regra === 'fixo') return `Frete fixo de ${moeda(c.frete.valor)}.${prazo}`;
  if (c.frete.regra === 'gratis_acima_de') return `Frete de ${moeda(c.frete.valor)}, grátis em pedidos a partir de ${moeda(c.frete.minimo)}.${prazo}`;
  return `Frete a combinar com o atendente depois do pedido.${prazo}`;
}

@Injectable()
export class FerramentasMcpService {
  private readonly logger = new Logger('MCP');

  constructor(
    private readonly catalogo: CatalogoService,
    private readonly configLoja: ConfigLojaService,
    private readonly sessoes: SessoesService,
    private readonly carrinho: CarrinhoService,
    private readonly clientes: ClientesService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async chamar(loja: Loja, nome: string, args: Record<string, unknown>): Promise<ResultadoFerramenta> {
    try {
      return { texto: await this.executar(loja, nome, args) };
    } catch (e) {
      if (e instanceof Recusa) return { texto: e.message, erro: true };
      if (e instanceof ErroApi) return { texto: e.mensagem, erro: true };
      if (e instanceof ErroConector) return { texto: e.message, erro: true };
      this.logger.error(`ferramenta ${nome}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      return { texto: 'Erro interno no Kentro Shop. Tente de novo em instantes ou transfira para um atendente.', erro: true };
    }
  }

  private executar(loja: Loja, nome: string, args: Record<string, unknown>): Promise<string> {
    switch (nome) {
      case 'buscar_produtos':
        return this.buscar(loja.id, args);
      case 'detalhes_produto':
        return this.detalhes(loja.id, obrigatorio(args, 'produto_id', 100));
      case 'listar_categorias':
        return this.categorias(loja.id);
      case 'info_loja':
        return this.infoLoja(loja);
      case 'gerar_link_catalogo':
        return this.gerarLink(loja.id, args);
      case 'adicionar_ao_carrinho':
        return this.adicionar(loja.id, args);
      case 'alterar_item_carrinho':
        return this.alterarItem(loja.id, args);
      case 'consultar_carrinho':
        return this.consultar(loja.id, obrigatorio(args, 'chat_id', 64));
      case 'pedidos_anteriores':
        return this.pedidosAnteriores(loja.id, obrigatorio(args, 'telefone', 30));
      default:
        throw new Recusa(`Ferramenta desconhecida: ${nome}.`);
    }
  }

  /** Produto que só está em categorias ocultas fica de fora, como no catálogo do cliente. */
  private visivel(config: ConfigEfetiva): (p: Produto) => boolean {
    const ocultas = new Set(config.categoriasOcultas);
    return (p) => !ocultas.size || !p.categoriaIds.length || p.categoriaIds.some((c) => !ocultas.has(c));
  }

  private async buscar(lojaId: string, args: Record<string, unknown>): Promise<string> {
    const config = await this.configLoja.obter(lojaId);
    const pagina = Math.max(1, Math.min(Number.parseInt(texto(args.pagina, 4), 10) || 1, 500));
    const busca = texto(args.busca, 100) || undefined;
    const categoriaId = texto(args.categoria_id, 50) || undefined;
    if (categoriaId && config.categoriasOcultas.includes(categoriaId)) return 'Esta categoria não está disponível para os clientes.';
    if (categoriaId) await this.categoriaExiste(lojaId, categoriaId);
    const lista = await this.catalogo.listarProdutos(lojaId, { busca, categoriaId, pagina });
    const itens = lista.itens.filter(this.visivel(config));
    if (!itens.length) {
      return pagina > 1
        ? 'Não há mais produtos nesta busca.'
        : 'Nenhum produto encontrado. A busca olha só o nome do produto: tire cor e tamanho e busque só o tipo de peça ou o modelo ' +
            '(ex.: "polo"), depois confira a cor nas opções. Também vale tentar sinônimos ou listar_categorias.';
    }
    const total = lista.total !== undefined ? ` de ${lista.total}` : '';
    const cabeca = `Página ${pagina}: ${itens.length}${total} produto(s).${lista.temMais ? ` Há mais: peça pagina ${pagina + 1}.` : ''}`;
    const inicio = (pagina - 1) * lista.porPagina;
    return [...avisoSemPreco(config.mostrarPrecos), cabeca, '', ...itens.map((p, i) => resumoDoProduto(p, config.mostrarPrecos, inicio + i + 1))].join('\n');
  }

  private async detalhes(lojaId: string, id: string): Promise<string> {
    const [config, p] = await Promise.all([this.configLoja.obter(lojaId), this.catalogo.obterProduto(lojaId, id)]);
    if (!this.visivel(config)(p)) return 'Produto não encontrado.';
    const mostrar = config.mostrarPrecos;
    const linhas = [...avisoSemPreco(mostrar), `${p.nome}${p.regras?.selo ? ` [${p.regras.selo}]` : ''}`, `produto_id ${p.id} · SKU ${p.sku} · vendido por ${unidade(p.unidade, 1)}`];
    if (!p.variacoes.length) linhas.push([preco(p, mostrar), estoque(p)].filter(Boolean).join(' · '));
    else {
      const valor = precoDoProduto(p, mostrar);
      if (valor) linhas.push(valor);
      linhas.push(...blocoDeVariacoes(p, mostrar, '', 200));
    }
    if (p.regras?.m2PorUnidade) linhas.push(`Cada ${unidade(p.unidade, 1)} tem ${p.regras.m2PorUnidade} m² (calcule a quantidade pela metragem do cliente + 10% de perda).`);
    if (p.regras?.rendimentoM2) linhas.push(`Rende ${p.regras.rendimentoM2} m² por ${unidade(p.unidade, 1)}.`);
    const descricao = p.descricao.replace(/\s+\n/g, '\n').trim();
    if (descricao) linhas.push('', 'Descrição:', descricao.length > MAX_DESCRICAO ? `${descricao.slice(0, MAX_DESCRICAO)}…` : descricao);
    if (p.imagens.length) linhas.push('', 'Fotos:', ...p.imagens.slice(0, 4));
    if (p.regras?.compreJunto.length) linhas.push('', `Compre junto (SKUs): ${p.regras.compreJunto.slice(0, 10).join(', ')}`);
    if (p.urlNaLoja) linhas.push('', `Página na loja virtual: ${p.urlNaLoja}`);
    return linhas.join('\n');
  }

  private async categorias(lojaId: string): Promise<string> {
    const [config, todas] = await Promise.all([this.configLoja.obter(lojaId), this.catalogo.listarCategorias(lojaId)]);
    const ocultas = new Set(config.categoriasOcultas);
    const visiveis = todas.filter((c) => !ocultas.has(c.id));
    if (!visiveis.length) return 'Esta loja não tem categorias. Use buscar_produtos com palavras do nome.';
    const nomes = new Map(visiveis.map((c) => [c.id, c.nome]));
    const linha = (c: Categoria) => `- categoria_id ${c.id}: ${c.paiId && nomes.has(c.paiId) ? `${nomes.get(c.paiId)} > ` : ''}${c.nome}`;
    return ['Categorias:', ...visiveis.map(linha)].join('\n');
  }

  private async infoLoja(loja: Loja): Promise<string> {
    const config = await this.configLoja.obter(loja.id);
    const linhas = [`Loja: ${config.tema.nome}`];
    linhas.push(config.entrega.habilitada ? `Entrega: sim. ${textoDoFrete(config)}` : 'Entrega: não fazemos entrega.');
    if (config.retirada.habilitada && config.lojasRetirada.length) {
      linhas.push('Retirada na loja: sim, em:');
      for (const l of config.lojasRetirada) {
        linhas.push(`- ${l.nome} — ${l.endereco}${l.horario ? ` — ${l.horario}` : ''}${l.orientacoes ? ` (${l.orientacoes})` : ''}`);
      }
    } else {
      linhas.push('Retirada na loja: não.');
    }
    const criaPedido = config.mostrarPrecos && (await this.integracoes.criaPedidoNaPlataforma(loja.id, config.modoPedido).catch(() => false));
    linhas.push(
      criaPedido
        ? 'Fechamento: ao finalizar no link, o pedido é criado na loja virtual e o cliente recebe um link de pagamento.'
        : 'Fechamento: ao finalizar no link, o pedido vai para um atendente, que confirma e combina o pagamento.',
    );
    linhas.push(config.mostrarPrecos ? 'Preços: aparecem no catálogo.' : 'Preços: NÃO aparecem no catálogo (o cliente monta uma lista para orçamento).');
    linhas.push(`Validade do link: ${config.expiracaoLinkDias} dia(s).`);
    return linhas.join('\n');
  }

  private async gerarLink(lojaId: string, args: Record<string, unknown>): Promise<string> {
    const chatId = obrigatorio(args, 'chat_id', 64);
    const produtoIds = listaDeTextos(args.produto_ids, 50);
    // Produtos escolhidos já definem a vitrine: categoria e busca junto só confundem o cliente.
    const categoriaId = produtoIds.length ? '' : texto(args.categoria_id, 50);
    const busca = produtoIds.length ? '' : texto(args.busca, 100);
    const restrito = booleano(args.restrito);
    const mostrarPrecos = booleano(args.mostrar_precos);
    if (categoriaId) await this.categoriaExiste(lojaId, categoriaId);
    const itens = await this.resolver(lojaId, itensDe(args.itens, 1));
    const filtro: FiltroLink | undefined =
      produtoIds.length || categoriaId || busca
        ? { ...(produtoIds.length ? { produtoIds } : {}), ...(categoriaId ? { categoriaId } : {}), ...(busca ? { busca } : {}) }
        : undefined;
    const montado = filtro || itens.length || restrito !== undefined || mostrarPrecos !== undefined ? { filtro, restrito, mostrarPrecos } : null;

    const antes = await this.sessoes.porChat(lojaId, chatId);
    const abertoComItens = antes && ABERTOS.includes(antes.status) && new Date(antes.expiraEm).getTime() > Date.now() && antes.itens.length > 0;
    if (montado && abertoComItens && booleano(args.substituir_link_aberto) !== true) {
      throw new Recusa(
        `O cliente já tem um link aberto com ${antes!.itens.length} item(ns) no carrinho (${antes!.url}). Um link personalizado novo ` +
          'descartaria esse carrinho. Para incluir produtos, use adicionar_ao_carrinho. Se o cliente pediu mesmo um link novo, ' +
          'chame de novo com substituir_link_aberto: true.',
      );
    }

    const contato = { chatId, nome: texto(args.nome, 120), telefone: texto(args.telefone, 30), email: texto(args.email, 120) };
    let sessao = await this.sessoes.criarOuReaproveitar(lojaId, contato, '', montado, 'ia');
    let avisos: string[] = [];
    if (itens.length) ({ sessao, avisos } = await this.carrinho.definirPeloAtendente(lojaId, sessao.id, itens, 'ia'));
    const config = await this.configLoja.obter(lojaId);
    const reaproveitado = antes?.id === sessao.id;
    return [
      reaproveitado ? 'Este atendimento já tinha um link aberto: é o mesmo link.' : 'Link novo gerado.',
      ...(avisos.length ? ['Avisos (conte ao cliente o que for relevante):', ...avisos.map((a) => `- ${a}`)] : []),
      ...(itens.length ? [CONFIRA] : []),
      '',
      textoDaSessao(sessao, precosVisiveis(sessao, config.mostrarPrecos)),
      '',
      `Envie ao cliente exatamente este link: ${sessao.url}`,
    ].join('\n');
  }

  /** Sessão aberta do chat, ou recusa explicando o que fazer. */
  private async aberta(lojaId: string, chatId: string): Promise<SessaoCompleta> {
    const sessao = await this.sessoes.porChat(lojaId, chatId);
    if (!sessao) throw new Recusa('Este atendimento ainda não tem link. Use gerar_link_catalogo (com itens, para já montar o carrinho).');
    if (!ABERTOS.includes(sessao.status)) {
      throw new Recusa(`O link deste atendimento não aceita mais mudanças (${SITUACAO[sessao.status] ?? sessao.status}). Para um pedido novo, use gerar_link_catalogo.`);
    }
    if (new Date(sessao.expiraEm).getTime() < Date.now()) throw new Recusa('O link deste atendimento expirou. Use gerar_link_catalogo para um novo.');
    return sessao;
  }

  private async adicionar(lojaId: string, args: Record<string, unknown>): Promise<string> {
    const sessao = await this.aberta(lojaId, obrigatorio(args, 'chat_id', 64));
    const pedidos = itensDe(args.itens, 1);
    if (!pedidos.length) throw new Recusa('Informe os itens.');
    const itens = await this.resolver(lojaId, pedidos);
    const r = await this.carrinho.adicionarPeloAtendente(lojaId, sessao.id, itens, 'ia');
    return this.respostaDoCarrinho(lojaId, r.sessao, r.avisos);
  }

  private async alterarItem(lojaId: string, args: Record<string, unknown>): Promise<string> {
    const sessao = await this.aberta(lojaId, obrigatorio(args, 'chat_id', 64));
    const [alvo] = itensDe([{ produto_id: args.produto_id, variacao: args.variacao, variacao_id: args.variacao_id, quantidade: args.quantidade }], 0);
    // Pelo nome, a variação é procurada entre as linhas do carrinho (o nome gravado é o da plataforma).
    const mesmo = (i: { produtoId: string; variacaoId: string | null; variacaoNome: string | null }) =>
      i.produtoId === alvo.produtoId &&
      (alvo.variacaoNome ? !!i.variacaoNome && mesmaVariacao(alvo.variacaoNome, { nome: i.variacaoNome }) : (i.variacaoId ?? '') === (alvo.variacaoId ?? ''));
    if (!sessao.itens.some(mesmo)) {
      const doProduto = sessao.itens.filter((i) => i.produtoId === alvo.produtoId && i.variacaoNome).map((i) => i.variacaoNome);
      const opcoes = doProduto.length ? ` No carrinho, este produto está em: ${doProduto.join('; ')}.` : '';
      if (alvo.quantidade === 0) throw new Recusa(`Este item não está no carrinho.${opcoes}`);
      throw new Recusa(`Este item não está no carrinho.${opcoes} Para incluir outra opção, use adicionar_ao_carrinho.`);
    }
    const itens: ItemPedidoDto[] = sessao.itens.map((i) => ({
      produtoId: i.produtoId,
      ...(i.variacaoId ? { variacaoId: i.variacaoId } : {}),
      quantidade: mesmo(i) ? alvo.quantidade : i.quantidade,
    }));
    const r = await this.carrinho.definirPeloAtendente(lojaId, sessao.id, itens, 'ia');
    return this.respostaDoCarrinho(lojaId, r.sessao, r.avisos);
  }

  private async respostaDoCarrinho(lojaId: string, sessao: SessaoCompleta, avisos: string[]): Promise<string> {
    const config = await this.configLoja.obter(lojaId);
    return [
      'Carrinho atualizado. O cliente vê a mudança no mesmo link (ao abrir ou voltar para a página).',
      ...(avisos.length ? ['Avisos (conte ao cliente o que for relevante):', ...avisos.map((a) => `- ${a}`)] : []),
      CONFIRA,
      '',
      textoDaSessao(sessao, precosVisiveis(sessao, config.mostrarPrecos)),
    ].join('\n');
  }

  /**
   * Variação pelo nome ("Preto / G") → id, conferida palavra a palavra. Nome que não existe volta como recusa com as
   * opções válidas, em vez de cair numa variação parecida.
   */
  private async resolver(lojaId: string, itens: ItemPedido[]): Promise<ItemPedidoDto[]> {
    const comNome = itens.filter((i) => i.variacaoNome);
    const produtos = comNome.length ? await this.catalogo.obterVarios(lojaId, comNome.map((i) => i.produtoId)) : new Map<string, Produto | null>();
    return itens.map((i) => {
      const produto = i.variacaoNome ? produtos.get(i.produtoId) : null;
      // Produto sumido ou sem variações: o carrinho decide (e avisa).
      if (!i.variacaoNome || !produto || !produto.variacoes.length) {
        return { produtoId: i.produtoId, quantidade: i.quantidade, ...(i.variacaoId ? { variacaoId: i.variacaoId } : {}) };
      }
      const variacao = encontrarVariacao(produto, i.variacaoNome);
      if (!variacao) throw new Recusa(`"${i.variacaoNome}" não é uma opção de ${produto.nome}. Opções: ${opcoesDe(produto)}.`);
      return { produtoId: i.produtoId, variacaoId: variacao.id, quantidade: i.quantidade };
    });
  }

  private async categoriaExiste(lojaId: string, categoriaId: string): Promise<void> {
    const todas = await this.catalogo.listarCategorias(lojaId);
    if (!todas.some((c) => c.id === categoriaId)) {
      throw new Recusa(`A categoria ${categoriaId} não existe. Use listar_categorias para ver os ids, ou busque só por palavras (sem categoria_id).`);
    }
  }

  private async consultar(lojaId: string, chatId: string): Promise<string> {
    const sessao = await this.sessoes.porChat(lojaId, chatId);
    if (!sessao) return 'Nenhum link de catálogo foi gerado neste atendimento.';
    const config = await this.configLoja.obter(lojaId);
    return textoDaSessao(sessao, precosVisiveis(sessao, config.mostrarPrecos), { eventos: true });
  }

  private async pedidosAnteriores(lojaId: string, telefone: string): Promise<string> {
    const [config, historico] = await Promise.all([this.configLoja.obter(lojaId), this.clientes.historico(lojaId, { nome: '', telefone })]);
    if (!historico.pedidos.length) return `Nenhum pedido anterior encontrado para ${telefoneBr(telefone) || telefone}.`;
    const linhas = [`Últimos pedidos de ${telefoneBr(telefone) || telefone}:`];
    for (const p of historico.pedidos) {
      const data = new Date(p.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      linhas.push('', `Pedido de ${data}${config.mostrarPrecos ? ` — ${moeda(p.total)}` : ''}:`);
      for (const i of p.itens) {
        const nome = i.variacaoNome ? `${i.nome} (${i.variacaoNome})` : i.nome;
        linhas.push(`- ${i.quantidade}x ${nome} [produto_id ${i.produtoId}${i.variacaoId ? `, variacao_id ${i.variacaoId}` : ''}]`);
      }
    }
    linhas.push('', 'Preço e estoque de hoje podem ser outros: ao montar o carrinho, a loja confere tudo de novo.');
    return linhas.join('\n');
  }
}
