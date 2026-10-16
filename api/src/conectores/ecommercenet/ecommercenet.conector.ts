import { Categoria, Pagina, Produto } from '../../contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../nucleo/conector';
import { NaoEncontrado, RecusadoPelaPlataforma } from '../nucleo/erros';
import { categoriaAtiva, categoriaDeEcn, produtoDeEcn, temVariacao, variacaoDeEcn } from './normalizar';

// Conector da eCommerce-net (spec 7.5, item 1). API indexada por SKU, token = base64(client_id:client_secret).
// O formato do cabeçalho (base64 puro ou "Basic ...") deve ser confirmado com as respostas reais gravadas.

type Bruto = Record<string, unknown>;

const LIMITE_POR_PAGINA = 200;
const NAO_E_A_API = 'O endereço não respondeu como a API da eCommerce-net. Confira o Endereço da API.';

/** A plataforma responde 400 com "Product not found" para SKU inexistente (OpenAPI). */
function naoEncontrado(e: unknown): boolean {
  return e instanceof NaoEncontrado || (e instanceof RecusadoPelaPlataforma && /not found|não encontrad/i.test(e.message));
}

function primeiroErro(errors: unknown): string {
  if (Array.isArray(errors)) return errors.length ? String(errors[0]) : '';
  if (errors && typeof errors === 'object') return String(Object.values(errors as Bruto)[0] ?? '');
  return errors ? String(errors) : '';
}

function lista(v: unknown): Bruto[] {
  if (Array.isArray(v)) return v as Bruto[];
  if (v && typeof v === 'object' && Object.keys(v).length) return [v as Bruto];
  return [];
}

async function chamar(ctx: CtxConector, operacao: string, caminho: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const base = (ctx.credenciais.url_api ?? '').trim().replace(/\/+$/, '');
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) if (valor !== undefined && valor !== '') query.set(chave, String(valor));
  const token = Buffer.from(`${ctx.credenciais.client_id}:${ctx.credenciais.client_secret}`).toString('base64');
  const resposta = await ctx.http.requisitar({
    metodo: 'GET',
    url: `${base}${caminho}${query.size ? `?${query}` : ''}`,
    operacao,
    cabecalhos: { Authorization: token },
  });
  const corpo = resposta.corpo as Bruto | string | null;
  // A plataforma pode responder 200 com success:false: isso é erro, nunca lista vazia.
  if (corpo && typeof corpo === 'object' && corpo.success === false) throw new RecusadoPelaPlataforma(primeiroErro(corpo.errors));
  // Resposta 200 que não é da API (ex.: o admin colou o endereço do site da loja) também é erro.
  if (!corpo || typeof corpo !== 'object' || corpo.success !== true) throw new RecusadoPelaPlataforma(NAO_E_A_API);
  return corpo.data;
}

/** Listas complementares (variações, relacionados): recusa da plataforma vira lista vazia. */
async function listaOuVazia(promessa: Promise<unknown>): Promise<Bruto[]> {
  try {
    return lista(await promessa);
  } catch (e) {
    if (e instanceof NaoEncontrado || e instanceof RecusadoPelaPlataforma) return [];
    throw e;
  }
}

export const conectorEcommercenet: Conector = {
  id: 'ecommercenet',
  nome: 'eCommerce-net',
  // Limite não documentado pela plataforma (spec 17.2): conservador até observar 429.
  ritmo: { porSegundo: 2, rajada: 5 },
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: true,
    estoque: true,
    relacionados: true,
    cotarFrete: false,
    criarPedido: false,
    oauth: false,
  },
  camposDeCredencial: [
    {
      chave: 'url_api',
      rotulo: 'Endereço da API',
      tipo: 'url',
      obrigatorio: true,
      ajuda: 'Endereço da API da sua loja, informado no painel da eCommerce-net em API.',
    },
    { chave: 'client_id', rotulo: 'Client ID', tipo: 'texto', obrigatorio: true, ajuda: 'Gerado no painel da loja, menu API.' },
    { chave: 'client_secret', rotulo: 'Client Secret', tipo: 'segredo', obrigatorio: true, ajuda: 'Gerado junto com o Client ID.' },
  ],

  async testarConexao(ctx) {
    await chamar(ctx, 'testarConexao', '/product/all', { page: 1, limit: 1 });
    return { ok: true };
  },

  async listarCategorias(ctx): Promise<Categoria[]> {
    const dados = await chamar(ctx, 'listarCategorias', '/category/findbyname', {});
    return lista(dados).filter(categoriaAtiva).map(categoriaDeEcn);
  },

  async listarProdutos(ctx, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
    const porPagina = Math.min(filtro.porPagina, LIMITE_POR_PAGINA);
    const dados = ((await chamar(ctx, 'listarProdutos', '/product/all', {
      page: filtro.pagina,
      limit: porPagina,
      status: 1, // só produtos ativos na loja
      search: filtro.busca?.trim(),
      category_id: filtro.categoriaId,
    })) ?? {}) as Bruto;
    const paginas = Number(dados.pages) || 0;
    const total = Number(dados.total);
    return {
      itens: lista(dados.products).map(produtoDeEcn),
      pagina: filtro.pagina,
      porPagina,
      ...(Number.isFinite(total) ? { total } : {}),
      temMais: filtro.pagina < paginas,
    };
  },

  async obterProduto(ctx, sku): Promise<Produto | null> {
    let bruto: Bruto | undefined;
    try {
      bruto = lista(await chamar(ctx, 'obterProduto', '/product/findBySku', { sku }))[0];
    } catch (e) {
      if (naoEncontrado(e)) return null;
      throw e;
    }
    if (!bruto || !bruto.sku) return null;
    const produto = produtoDeEcn(bruto);
    if (temVariacao(bruto)) {
      const titulo = produto.atributosVariacao?.[0] ?? '';
      const variacoes = await listaOuVazia(chamar(ctx, 'listarVariacoes', '/product/findvarietybyproductskuv2', { product_sku: sku }));
      produto.variacoes = variacoes.map((v) => variacaoDeEcn(v, titulo, produto));
      if (produto.variacoes.length) produto.disponivel = produto.variacoes.some((v) => v.disponivel);
    }
    return produto;
  },

  async relacionados(ctx, sku): Promise<Produto[]> {
    const [compreJunto, relacionados] = await Promise.all([
      listaOuVazia(chamar(ctx, 'compreJunto', '/product/findbuyitwithbysku', { sku })),
      listaOuVazia(chamar(ctx, 'relacionados', '/product/findRelatedBySku', { sku })),
    ]);
    const vistos = new Set([sku]);
    return [...compreJunto, ...relacionados]
      .map(produtoDeEcn)
      .filter((p) => p.sku && !vistos.has(p.sku) && vistos.add(p.sku));
  },
};
