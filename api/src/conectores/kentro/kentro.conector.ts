import { Categoria, Pagina, Produto } from '../../contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../nucleo/conector';
import { NaoEncontrado, RecusadoPelaPlataforma } from '../nucleo/erros';
import { htmlParaTexto, urlHttps } from '../nucleo/texto';

// Catálogo interno da Kentro, para a loja que não tem e-commerce. A API lê os produtos pelo servidor MCP
// da própria instância (JSON-RPC por HTTP "streamable"), com um token que o admin gera na Kentro.
// Formato dos produtos conferido na instância de teste (products_get/products_list: valores em centavos).

type Bruto = Record<string, unknown>;

const VERSAO_PROTOCOLO = '2025-06-18';
const ACEITA = 'application/json, text/event-stream';

const obj = (v: unknown): Bruto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const centavos = (v: unknown): number => Math.round(Number(v) || 0) / 100;

/** Endereço do MCP a partir do que o admin colou ("https://empresa.atenderbem.com" ou ".../mcp"). */
export function enderecoMcp(url: string | undefined): string {
  let u: URL;
  try {
    u = new URL((url ?? '').trim());
  } catch {
    throw new RecusadoPelaPlataforma('Confira o endereço da Kentro (ex.: https://suaempresa.atenderbem.com).');
  }
  if (u.protocol !== 'https:') throw new RecusadoPelaPlataforma('O endereço da Kentro precisa começar com https://.');
  const caminho = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${caminho.endsWith('/mcp') ? caminho : `${caminho}/mcp`}`;
}

// ── Cliente MCP ──────────────────────────────────────────────────────────

// Sessão aberta por loja + endereço ('' = o servidor não usa sessão).
const sessoes = new Map<string, string>();
let proximoId = 1;

/** A resposta pode vir em JSON ou em SSE ("data: {...}"): acha a mensagem JSON-RPC daquela chamada. */
function mensagemDaResposta(corpo: unknown, id: number): Bruto {
  if (corpo && typeof corpo === 'object') return corpo as Bruto;
  const mensagens: Bruto[] = [];
  for (const evento of String(corpo ?? '').split(/\r?\n\r?\n/)) {
    const dados = evento
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!dados) continue;
    try {
      mensagens.push(JSON.parse(dados) as Bruto);
    } catch {
      // evento que não é JSON: ignora
    }
  }
  return mensagens.find((m) => m.id === id) ?? mensagens.find((m) => 'result' in m || 'error' in m) ?? {};
}

function cabecalhos(ctx: CtxConector, sessao?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${texto(ctx.credenciais.token_mcp)}`,
    Accept: ACEITA,
    ...(sessao ? { 'Mcp-Session-Id': sessao } : {}),
  };
}

async function abrirSessao(ctx: CtxConector, url: string): Promise<string> {
  const id = proximoId++;
  const resposta = await ctx.http.requisitar({
    metodo: 'POST',
    url,
    operacao: 'mcpInicializar',
    cabecalhos: cabecalhos(ctx),
    corpo: { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: VERSAO_PROTOCOLO, capabilities: {}, clientInfo: { name: 'kentro-shop', version: '1.0.0' } } },
  });
  const msg = mensagemDaResposta(resposta.corpo, id);
  if (msg.error) throw new RecusadoPelaPlataforma(texto(obj(msg.error).message) || 'A Kentro recusou a conexão.');
  const sessao = resposta.cabecalhos?.['mcp-session-id'] ?? '';
  await ctx.http.requisitar({
    metodo: 'POST',
    url,
    operacao: 'mcpInicializado',
    cabecalhos: cabecalhos(ctx, sessao),
    corpo: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  return sessao;
}

/** Chama uma ferramenta do MCP da instância e devolve o JSON do resultado. */
async function ferramenta(ctx: CtxConector, nome: string, argumentos: Bruto, tentativa = 0): Promise<unknown> {
  const url = enderecoMcp(ctx.credenciais.url_kentro);
  const chave = `${ctx.lojaId}|${url}`;
  let sessao = sessoes.get(chave);
  if (sessao === undefined) {
    sessao = await abrirSessao(ctx, url);
    sessoes.set(chave, sessao);
  }
  const id = proximoId++;
  let resposta;
  try {
    resposta = await ctx.http.requisitar({
      metodo: 'POST',
      url,
      operacao: nome,
      cabecalhos: cabecalhos(ctx, sessao),
      corpo: { jsonrpc: '2.0', id, method: 'tools/call', params: { name: nome, arguments: argumentos } },
    });
  } catch (e) {
    // 404 com sessão = o servidor esqueceu a sessão (reinício): abre outra e repete uma vez.
    if (e instanceof NaoEncontrado && tentativa === 0) {
      sessoes.delete(chave);
      return ferramenta(ctx, nome, argumentos, 1);
    }
    throw e;
  }
  const msg = mensagemDaResposta(resposta.corpo, id);
  if (msg.error) throw new RecusadoPelaPlataforma(texto(obj(msg.error).message) || 'A Kentro recusou a consulta.');
  const resultado = obj(msg.result);
  const conteudo = lista(resultado.content).map((c) => texto(obj(c).text)).join('\n');
  if (resultado.isError) {
    if (/não encontrad|not found/i.test(conteudo)) throw new NaoEncontrado(conteudo);
    throw new RecusadoPelaPlataforma(conteudo || 'A Kentro recusou a consulta.');
  }
  if (resultado.structuredContent !== undefined) return resultado.structuredContent;
  try {
    return JSON.parse(conteudo);
  } catch {
    throw new RecusadoPelaPlataforma('A Kentro respondeu num formato inesperado.');
  }
}

// ── Produto ──────────────────────────────────────────────────────────────

/** Arquivado ou oculto para clientes não aparece no catálogo (nem entra no carrinho). */
const visivelAoCliente = (p: Bruto) => texto(p.status) !== 'archived' && Number(p.hiddenfromclients) !== 1;

const idDoGrupo = (g: unknown) => texto(typeof g === 'object' ? obj(g).id : g);
const urlDaFoto = (f: unknown) => urlHttps(texto(typeof f === 'object' ? (obj(f).url ?? obj(f).src ?? obj(f).link) : f));

export function produtoDaKentro(p: Bruto): Produto {
  const valor = centavos(p.value);
  const promocao = centavos(p.saleprice);
  const emPromocao = promocao > 0 && promocao < valor;
  const preco = emPromocao ? promocao : valor;
  const qtd = Number(p.qty);
  return {
    id: texto(p.id),
    sku: texto(p.internalcode) || texto(p.id),
    nome: texto(p.name),
    descricao: htmlParaTexto(texto(p.description)),
    imagens: lista(p.photos)
      .map(urlDaFoto)
      .filter((u): u is string => !!u),
    preco,
    ...(emPromocao ? { precoDe: valor } : {}),
    unidade: texto(p.measurementunit).toUpperCase() || 'UN',
    // A Kentro não obriga controle de estoque: quantidade zerada vira "não controla".
    estoque: Number.isFinite(qtd) && qtd > 0 ? qtd : null,
    // Sem preço cadastrado continua disponível: serve ao catálogo sem preço (lista para orçamento).
    // Com preços visíveis, o carrinho recusa produto sem preço.
    disponivel: Number(p.available) === 1,
    categoriaIds: lista(p.groups).map(idDoGrupo).filter(Boolean),
    variacoes: [],
  };
}

export const conectorKentro: Conector = {
  id: 'kentro',
  nome: 'Catálogo da Kentro',
  ritmo: { porSegundo: 5, rajada: 10 },
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: false,
    estoque: true,
    relacionados: false,
    cotarFrete: false,
    criarPedido: false,
    oauth: false,
    historicoCliente: false,
  },
  camposDeCredencial: [
    {
      chave: 'url_kentro',
      rotulo: 'Endereço da sua Kentro',
      tipo: 'url',
      obrigatorio: true,
      ajuda: 'O endereço que você usa para entrar na Kentro, ex.: https://suaempresa.atenderbem.com',
    },
    {
      chave: 'token_mcp',
      rotulo: 'Token do MCP da Kentro',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'Gerado na Kentro para acesso ao MCP (leitura de produtos). Os produtos e grupos vêm do cadastro da Kentro.',
    },
  ],

  async testarConexao(ctx) {
    await ferramenta(ctx, 'product_groups_list', {});
    return { ok: true };
  },

  async listarCategorias(ctx): Promise<Categoria[]> {
    const dados = obj(await ferramenta(ctx, 'product_groups_list', {}));
    return lista(dados.groups).map((g) => ({ id: idDoGrupo(g), nome: texto(obj(g).name) }));
  },

  async listarProdutos(ctx, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
    const limite = Math.min(filtro.porPagina, 100);
    const offset = (filtro.pagina - 1) * limite;
    const argumentos: Bruto = { limit: limite, offset };
    if (filtro.busca?.trim()) argumentos.search = filtro.busca.trim().slice(0, 100);
    if (filtro.categoriaId) {
      const grupo = Number(filtro.categoriaId);
      if (!Number.isInteger(grupo) || grupo <= 0) return { itens: [], pagina: filtro.pagina, porPagina: limite, temMais: false };
      argumentos.groupId = grupo;
    }
    const dados = obj(await ferramenta(ctx, 'products_list', argumentos));
    const brutos = lista(dados.products).map(obj);
    const total = Number(dados.total);
    return {
      itens: brutos.filter(visivelAoCliente).map(produtoDaKentro),
      pagina: filtro.pagina,
      porPagina: limite,
      ...(Number.isFinite(total) ? { total } : {}),
      temMais: Number.isFinite(total) ? offset + limite < total : brutos.length === limite,
    };
  },

  /** Pelo id da Kentro ou pelo código interno (SKU). Arquivado, oculto ou inexistente: null. */
  async obterProduto(ctx, id): Promise<Produto | null> {
    const chave = id.trim();
    if (!chave) return null;
    let numero = /^\d+$/.test(chave) ? Number(chave) : null;
    if (numero === null) {
      const dados = obj(await ferramenta(ctx, 'products_list', { search: chave.slice(0, 100), limit: 20, offset: 0 }));
      const achado = lista(dados.products).map(obj).find((p) => texto(p.internalcode).toLowerCase() === chave.toLowerCase());
      if (!achado) return null;
      numero = Number(achado.id);
    }
    let bruto: Bruto;
    try {
      bruto = obj(await ferramenta(ctx, 'products_get', { id: numero }));
    } catch (e) {
      if (e instanceof NaoEncontrado) return null;
      throw e;
    }
    if (!bruto.id || !visivelAoCliente(bruto)) return null;
    return produtoDaKentro(bruto);
  },
};
