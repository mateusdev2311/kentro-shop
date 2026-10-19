import { Categoria, Endereco, HistoricoCliente, Pagina, Produto, Variacao } from '../../contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../nucleo/conector';
import { CredencialInvalida, RecusadoPelaPlataforma } from '../nucleo/erros';
import { htmlParaTexto, numero, urlHttps } from '../nucleo/texto';

// Conector da Shopify (headless). Catálogo pela Storefront API (GraphQL, token Storefront).
// Com o token da Admin API (opcional): produto pelo SKU e histórico do cliente pelo telefone.
// Formato tirado da documentação e da coleção do usuário (API 2026-10); ainda sem respostas reais gravadas.

type Bruto = Record<string, unknown>;

export const VERSAO_API = '2026-10';
const MAX_POR_CONSULTA = 250; // limite do "first" da Shopify
const NAO_E_A_API = 'A loja não respondeu como a API da Shopify. Confira o domínio .myshopify.com.';
const ADMIN_RECUSADO = 'O token da Admin API foi recusado. Confira o token ou deixe o campo vazio para usar só o catálogo.';

const lista = (v: unknown): Bruto[] => (Array.isArray(v) ? (v as Bruto[]) : []);
const obj = (v: unknown): Bruto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : {});
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const idNumerico = (gidOuId: unknown): string => texto(gidOuId).split('/').pop() ?? '';
const gid = (tipo: string, id: string) => `gid://shopify/${tipo}/${id}`;
const dinheiro = (v: unknown): number | null => numero(obj(v).amount);

/**
 * Só `<loja>.myshopify.com`: é o endereço das APIs, e travar o sufixo impede mandar o token para outro lugar.
 * Aceita "minha-loja", "minha-loja.myshopify.com" ou a URL do painel.
 */
export function normalizarDominio(entrada: string | undefined): string {
  let d = (entrada ?? '').trim().toLowerCase().replace(/^https?:\/\//, '');
  d = d.split(/[/?#]/)[0];
  if (/^[a-z0-9][a-z0-9-]*$/.test(d)) d = `${d}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) {
    throw new RecusadoPelaPlataforma('Use o endereço da loja que termina em .myshopify.com (ex.: minha-loja.myshopify.com).');
  }
  return d;
}

/** Texto do cliente vai para a busca da Shopify sem os caracteres da sintaxe de consulta. */
function termoDeBusca(busca: string): string {
  return busca.replace(/["'\\:()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

async function gql(ctx: CtxConector, api: 'storefront' | 'admin', operacao: string, query: string, variables: Bruto = {}): Promise<Bruto> {
  const dominio = normalizarDominio(ctx.credenciais.dominio);
  const admin = api === 'admin';
  const resposta = await ctx.http.requisitar({
    metodo: 'POST',
    url: admin ? `https://${dominio}/admin/api/${VERSAO_API}/graphql.json` : `https://${dominio}/api/${VERSAO_API}/graphql.json`,
    operacao,
    cabecalhos: admin
      ? { 'X-Shopify-Access-Token': texto(ctx.credenciais.token_admin) }
      : { 'X-Shopify-Storefront-Access-Token': texto(ctx.credenciais.token_storefront) },
    corpo: { query, variables, operationName: operacao },
  });
  const corpo = obj(resposta.corpo);
  // GraphQL responde 200 com "errors" quando a consulta falha: isso é erro, nunca resultado vazio.
  const erros = lista(corpo.errors);
  if (erros.length) throw new RecusadoPelaPlataforma(texto(erros[0].message) || 'A Shopify recusou a consulta.');
  if (!corpo.data || typeof corpo.data !== 'object') throw new RecusadoPelaPlataforma(NAO_E_A_API);
  return corpo.data as Bruto;
}

// ── Produto ──────────────────────────────────────────────────────────────

const CONTEXTO = '@inContext(country: BR, language: PT_BR)';

function fragmento(comEstoque: boolean): string {
  return `fragment P on Product {
  id handle title description availableForSale
  images(first: 10) { nodes { url } }
  collections(first: 20) { nodes { id } }
  options { name }
  variants(first: 100) { nodes {
    id title sku availableForSale ${comEstoque ? 'quantityAvailable' : ''}
    price { amount } compareAtPrice { amount }
    selectedOptions { name value } image { url }
  } }
}`;
}

// Lojas cujo token Storefront não tem o escopo de estoque (unauthenticated_read_product_inventory).
const semEscopoDeEstoque = new Set<string>();

/** Consulta que traz produtos: tenta com estoque; sem o escopo, repete sem e lembra disso. */
async function comProdutos(ctx: CtxConector, operacao: string, consulta: string, variables: Bruto): Promise<Bruto> {
  const chave = `${ctx.lojaId}|${normalizarDominio(ctx.credenciais.dominio)}`;
  if (!semEscopoDeEstoque.has(chave)) {
    try {
      return await gql(ctx, 'storefront', operacao, `${consulta}\n${fragmento(true)}`, variables);
    } catch (e) {
      if (!(e instanceof RecusadoPelaPlataforma && /quantityAvailable/.test(e.message))) throw e;
      semEscopoDeEstoque.add(chave);
    }
  }
  return gql(ctx, 'storefront', operacao, `${consulta}\n${fragmento(false)}`, variables);
}

function estoqueDe(v: Bruto): number | null {
  return typeof v.quantityAvailable === 'number' ? v.quantityAvailable : null;
}

export function produtoDeShopify(p: Bruto, dominio: string): Produto {
  const handle = texto(p.handle);
  const variantes = lista(obj(p.variants).nodes);
  const opcoes = lista(p.options)
    .map((o) => texto(o.name))
    .filter((n) => n && n !== 'Title');
  // Produto sem opções: a Shopify cria uma variante "Default Title".
  const simples = variantes.length <= 1 && (!opcoes.length || texto(variantes[0]?.title) === 'Default Title');
  const imagens = lista(obj(p.images).nodes)
    .map((i) => urlHttps(texto(i.url)))
    .filter((u): u is string => !!u);
  const base = {
    id: handle,
    nome: texto(p.title),
    descricao: htmlParaTexto(texto(p.description)),
    imagens,
    unidade: 'UN',
    categoriaIds: lista(obj(p.collections).nodes).map((c) => idNumerico(c.id)),
    urlNaLoja: `https://${dominio}/products/${handle}`,
  };

  if (simples) {
    const v = variantes[0] ?? {};
    const preco = dinheiro(v.price) ?? 0;
    const de = dinheiro(v.compareAtPrice);
    return {
      ...base,
      sku: texto(v.sku) || handle,
      preco,
      ...(de && de > preco ? { precoDe: de } : {}),
      estoque: estoqueDe(v),
      disponivel: p.availableForSale !== false && v.availableForSale !== false && preco > 0,
      variacoes: [],
    };
  }

  const variacoes: Variacao[] = variantes.map((v) => {
    const id = idNumerico(v.id);
    const preco = dinheiro(v.price) ?? 0;
    const de = dinheiro(v.compareAtPrice);
    const imagem = urlHttps(texto(obj(v.image).url));
    return {
      id,
      sku: texto(v.sku) || `${handle}-${id}`,
      nome: texto(v.title),
      atributos: Object.fromEntries(lista(v.selectedOptions).map((o) => [texto(o.name), texto(o.value)])),
      preco,
      ...(de && de > preco ? { precoDe: de } : {}),
      estoque: estoqueDe(v),
      disponivel: v.availableForSale !== false && preco > 0,
      ...(imagem ? { imagem } : {}),
    };
  });
  const vendaveis = variacoes.filter((v) => v.disponivel);
  const precos = (vendaveis.length ? vendaveis : variacoes).map((v) => v.preco).filter((n) => n > 0);
  const estoques = variacoes.map((v) => v.estoque);
  return {
    ...base,
    // Regras da loja (selo, m², compre junto) são por SKU; produto com variações usa o handle.
    sku: handle,
    preco: precos.length ? Math.min(...precos) : 0,
    estoque: estoques.every((e): e is number => typeof e === 'number') ? estoques.reduce((s, e) => s + e, 0) : null,
    disponivel: p.availableForSale !== false && vendaveis.length > 0,
    variacoes,
    ...(opcoes.length ? { atributosVariacao: opcoes } : {}),
  };
}

// ── Consultas ────────────────────────────────────────────────────────────

const Q_PRODUTOS = `query Produtos($n: Int!, $after: String, $q: String) ${CONTEXTO} {
  products(first: $n, after: $after, query: $q) { pageInfo { hasNextPage } nodes { ...P } }
}`;
const Q_CURSORES = `query Cursores($n: Int!, $after: String, $q: String) {
  products(first: $n, after: $after, query: $q) { pageInfo { hasNextPage } edges { cursor } }
}`;
const Q_PRODUTOS_COLECAO = `query ProdutosColecao($id: ID!, $n: Int!, $after: String) ${CONTEXTO} {
  collection(id: $id) { products(first: $n, after: $after) { pageInfo { hasNextPage } nodes { ...P } } }
}`;
const Q_CURSORES_COLECAO = `query CursoresColecao($id: ID!, $n: Int!, $after: String) {
  collection(id: $id) { products(first: $n, after: $after) { pageInfo { hasNextPage } edges { cursor } } }
}`;
const Q_PRODUTO = `query Produto($handle: String!) ${CONTEXTO} { product(handle: $handle) { ...P } }`;
const Q_PRODUTO_POR_ID = `query ProdutoPorId($id: ID!) ${CONTEXTO} { product(id: $id) { ...P } }`;
const Q_RELACIONADOS = `query Relacionados($id: ID!) ${CONTEXTO} { productRecommendations(productId: $id) { ...P } }`;
const Q_CATEGORIAS = `query Categorias($after: String) {
  collections(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id title } }
}`;
const Q_SKU_ADMIN = `query SkuAdmin($q: String!) { productVariants(first: 1, query: $q) { nodes { product { handle } } } }`;
const Q_CLIENTE_ADMIN = `query ClienteAdmin($q: String!) {
  customers(first: 1, query: $q) { nodes {
    displayName email
    addresses(first: 5) { address1 address2 city provinceCode zip }
    orders(first: 5, sortKey: CREATED_AT, reverse: true) { nodes {
      name createdAt totalPriceSet { shopMoney { amount } }
      lineItems(first: 50) { nodes { title quantity sku } }
    } }
  } }
}`;

const conexaoDe = (dados: Bruto, colecao: boolean): Bruto | null =>
  colecao ? (obj(dados.collection).products as Bruto | undefined) ?? null : (dados.products as Bruto | undefined) ?? null;

const temAdmin = (ctx: CtxConector) => !!texto(ctx.credenciais.token_admin);

async function produtoPorHandle(ctx: CtxConector, handle: string): Promise<Produto | null> {
  const dados = await comProdutos(ctx, 'Produto', Q_PRODUTO, { handle });
  return dados.product ? produtoDeShopify(dados.product as Bruto, normalizarDominio(ctx.credenciais.dominio)) : null;
}

export const conectorShopify: Conector = {
  id: 'shopify',
  nome: 'Shopify',
  // Storefront API: limite por IP de comprador, folgado para o servidor; Admin API: 2 pontos/s no plano básico.
  ritmo: { porSegundo: 4, rajada: 10 },
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: true,
    estoque: true,
    relacionados: true,
    cotarFrete: false,
    criarPedido: false,
    oauth: false,
    historicoCliente: true,
  },
  camposDeCredencial: [
    {
      chave: 'dominio',
      rotulo: 'Endereço da loja (.myshopify.com)',
      tipo: 'texto',
      obrigatorio: true,
      ajuda: 'Ex.: minha-loja.myshopify.com — aparece no painel da Shopify em Configurações > Domínios.',
    },
    {
      chave: 'token_storefront',
      rotulo: 'Token da Storefront API',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'Catálogo da loja. Crie no canal Headless (ou num app) com acesso de leitura a produtos e coleções; marque também o estoque.',
    },
    {
      chave: 'token_admin',
      rotulo: 'Token da Admin API (opcional)',
      tipo: 'segredo',
      obrigatorio: false,
      ajuda: 'Habilita busca por SKU e o histórico do cliente (endereços e pedidos). App personalizado com read_products, read_customers e read_orders.',
    },
  ],

  destino: (credenciais) => normalizarDominio(credenciais.dominio),

  async testarConexao(ctx) {
    const dados = await gql(ctx, 'storefront', 'Loja', 'query Loja { shop { name } }');
    const nomeLoja = texto(obj(dados.shop).name) || undefined;
    if (temAdmin(ctx)) {
      try {
        await gql(ctx, 'admin', 'LojaAdmin', 'query LojaAdmin { shop { name } }');
      } catch (e) {
        if (e instanceof CredencialInvalida) return { ok: false, mensagem: ADMIN_RECUSADO };
        throw e;
      }
    }
    return { ok: true, ...(nomeLoja ? { nomeLoja } : {}) };
  },

  async listarCategorias(ctx): Promise<Categoria[]> {
    const categorias: Categoria[] = [];
    let after: string | null = null;
    for (let volta = 0; volta < 4; volta++) {
      const dados = await gql(ctx, 'storefront', 'Categorias', Q_CATEGORIAS, { after });
      const conexao = obj(dados.collections);
      for (const c of lista(conexao.nodes)) categorias.push({ id: idNumerico(c.id), nome: texto(c.title) });
      const pagina = obj(conexao.pageInfo);
      if (!pagina.hasNextPage) break;
      after = texto(pagina.endCursor);
    }
    return categorias;
  },

  async listarProdutos(ctx, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
    const n = Math.min(filtro.porPagina, MAX_POR_CONSULTA);
    const vazio: Pagina<Produto> = { itens: [], pagina: filtro.pagina, porPagina: n, temMais: false };
    const q = filtro.busca ? termoDeBusca(filtro.busca) || undefined : undefined;
    const categoria = filtro.categoriaId?.trim();
    if (categoria && !/^\d+$/.test(categoria)) return vazio;
    // A coleção não aceita busca por texto: com os dois filtros, busca e confere a coleção do produto.
    const porColecao = !!categoria && !q;
    const vars: Bruto = porColecao ? { id: gid('Collection', categoria!) } : { q };

    // A Shopify pagina por cursor: para a página N, anda até o cursor do item anterior a ela.
    let after: string | null = null;
    for (let restante = (filtro.pagina - 1) * n; restante > 0; ) {
      const passo = Math.min(restante, MAX_POR_CONSULTA);
      const dados = await gql(ctx, 'storefront', porColecao ? 'CursoresColecao' : 'Cursores', porColecao ? Q_CURSORES_COLECAO : Q_CURSORES, { ...vars, n: passo, after });
      const arestas = lista(conexaoDe(dados, porColecao)?.edges);
      if (arestas.length < passo) return vazio;
      after = texto(arestas[arestas.length - 1].cursor);
      restante -= passo;
    }

    const dados = await comProdutos(ctx, porColecao ? 'ProdutosColecao' : 'Produtos', porColecao ? Q_PRODUTOS_COLECAO : Q_PRODUTOS, { ...vars, n, after });
    const conexao = conexaoDe(dados, porColecao);
    if (!conexao) return vazio;
    const dominio = normalizarDominio(ctx.credenciais.dominio);
    let itens = lista(conexao.nodes).map((p) => produtoDeShopify(p, dominio));
    if (categoria && !porColecao) itens = itens.filter((p) => p.categoriaIds.includes(categoria));
    return { itens, pagina: filtro.pagina, porPagina: n, temMais: obj(conexao.pageInfo).hasNextPage === true };
  },

  /** Aceita o handle (id usado no catálogo), o id numérico do produto ou, com a Admin API, o SKU. */
  async obterProduto(ctx, id): Promise<Produto | null> {
    const chave = id.trim();
    if (!chave) return null;
    if (/^\d+$/.test(chave)) {
      const dados = await comProdutos(ctx, 'ProdutoPorId', Q_PRODUTO_POR_ID, { id: gid('Product', chave) });
      if (dados.product) return produtoDeShopify(dados.product as Bruto, normalizarDominio(ctx.credenciais.dominio));
    }
    const porHandle = await produtoPorHandle(ctx, chave.toLowerCase());
    if (porHandle || !temAdmin(ctx)) return porHandle;
    const dados = await gql(ctx, 'admin', 'SkuAdmin', Q_SKU_ADMIN, { q: `sku:"${chave.replace(/["\\]/g, '')}"` });
    const handle = texto(obj(lista(obj(dados.productVariants).nodes)[0]?.product).handle);
    return handle ? produtoPorHandle(ctx, handle) : null;
  },

  async relacionados(ctx, id): Promise<Produto[]> {
    const ref = await gql(ctx, 'storefront', 'Produto', 'query Produto($handle: String!) { product(handle: $handle) { id } }', { handle: id.trim().toLowerCase() });
    const gidProduto = texto(obj(ref.product).id);
    if (!gidProduto) return [];
    const dados = await comProdutos(ctx, 'Relacionados', Q_RELACIONADOS, { id: gidProduto });
    const dominio = normalizarDominio(ctx.credenciais.dominio);
    return lista(dados.productRecommendations).map((p) => produtoDeShopify(p, dominio)).slice(0, 8);
  },

  /** Endereços e últimos pedidos pelo telefone (Admin API). Sem o token Admin: null. */
  async historicoDoCliente(ctx, { telefone }): Promise<HistoricoCliente | null> {
    if (!temAdmin(ctx)) return null;
    let digitos = telefone.replace(/\D/g, '');
    if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
    if (digitos.length < 12) return null;
    const dados = await gql(ctx, 'admin', 'ClienteAdmin', Q_CLIENTE_ADMIN, { q: `phone:+${digitos}` });
    const cliente = lista(obj(dados.customers).nodes)[0];
    if (!cliente) return null;
    const enderecos: Endereco[] = lista(cliente.addresses).map((a) => ({
      cep: texto(a.zip),
      estado: texto(a.provinceCode).toUpperCase(),
      cidade: texto(a.city),
      bairro: '',
      rua: texto(a.address1),
      numero: '',
      complemento: texto(a.address2),
    }));
    const email = texto(cliente.email);
    return {
      nome: texto(cliente.displayName),
      ...(email ? { email } : {}),
      enderecos,
      pedidos: lista(obj(cliente.orders).nodes).map((o) => ({
        numero: texto(o.name),
        data: texto(o.createdAt),
        total: numero(obj(obj(o.totalPriceSet).shopMoney).amount) ?? 0,
        itens: lista(obj(o.lineItems).nodes).map((i) => ({ sku: texto(i.sku), nome: texto(i.title), quantidade: Number(i.quantity) || 0 })),
      })),
    };
  },
};
