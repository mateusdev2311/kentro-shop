// Shopify simulada (Storefront + Admin GraphQL) para os testes do conector. Dados SINTÉTICOS no formato da
// documentação (coleção Postman do usuário, API 2026-10): ainda não há respostas reais gravadas.

export const SHOPIFY_CREDENCIAIS = { dominio: 'loja-teste.myshopify.com', token_storefront: 'sf-certo', token_admin: '' };
export const SHOPIFY_COM_ADMIN = { ...SHOPIFY_CREDENCIAIS, token_admin: 'adm-certo' };

export interface ChamadaShopify {
  api: 'storefront' | 'admin';
  url: string;
  operacao: string;
  variaveis: Record<string, unknown>;
  cabecalhos: Record<string, string>;
}

const gid = (tipo: string, id: number) => `gid://shopify/${tipo}/${id}`;
const dinheiro = (v: number | null) => (v === null ? null : { amount: v.toFixed(1), currencyCode: 'BRL' });

interface VarianteBruta {
  id: number;
  title: string;
  sku: string;
  preco: number;
  de?: number;
  qtd: number | null;
  disponivel: boolean;
  opcoes: Record<string, string>;
}

const produtos = [
  {
    id: 101,
    handle: 'porcelanato-calacata',
    title: 'Porcelanato Calacata 60x60',
    description: 'Porcelanato polido.\nCaixa com 1,44 m².',
    disponivel: true,
    imagens: ['https://cdn.shopify.com/s/files/calacata.jpg'],
    colecoes: [1],
    opcoes: ['Title'],
    variantes: [{ id: 1001, title: 'Default Title', sku: 'PRC-CAL', preco: 119.9, de: 129.9, qtd: 10, disponivel: true, opcoes: { Title: 'Default Title' } }],
  },
  {
    id: 102,
    handle: 'tinta-acrilica',
    title: 'Tinta Acrílica 18L',
    description: 'Rende até 380 m².',
    disponivel: true,
    imagens: [],
    colecoes: [2],
    opcoes: ['Cor'],
    variantes: [
      { id: 1002, title: 'Branco', sku: 'TNT-BR', preco: 80, qtd: 5, disponivel: true, opcoes: { Cor: 'Branco' } },
      { id: 1003, title: 'Preto', sku: 'TNT-PR', preco: 90, qtd: 0, disponivel: false, opcoes: { Cor: 'Preto' } },
    ],
  },
  {
    id: 103,
    handle: 'argamassa-ac3',
    title: 'Argamassa AC3 20kg',
    description: '',
    disponivel: true,
    imagens: ['http://inseguro.exemplo/arg.jpg'],
    colecoes: [1],
    opcoes: ['Title'],
    variantes: [{ id: 1004, title: 'Default Title', sku: 'ARG-AC3', preco: 39.9, qtd: null, disponivel: true, opcoes: { Title: 'Default Title' } }],
  },
] as { id: number; handle: string; title: string; description: string; disponivel: boolean; imagens: string[]; colecoes: number[]; opcoes: string[]; variantes: VarianteBruta[] }[];

const colecoes = [
  { id: 1, title: 'Pisos' },
  { id: 2, title: 'Tintas' },
];

function produtoGql(p: (typeof produtos)[number], comEstoque: boolean) {
  return {
    id: gid('Product', p.id),
    handle: p.handle,
    title: p.title,
    description: p.description,
    availableForSale: p.disponivel,
    images: { nodes: p.imagens.map((url) => ({ url })) },
    collections: { nodes: p.colecoes.map((c) => ({ id: gid('Collection', c) })) },
    options: p.opcoes.map((name) => ({ name })),
    variants: {
      nodes: p.variantes.map((v) => ({
        id: gid('ProductVariant', v.id),
        title: v.title,
        sku: v.sku,
        availableForSale: v.disponivel,
        ...(comEstoque ? { quantityAvailable: v.qtd } : {}),
        price: dinheiro(v.preco),
        compareAtPrice: dinheiro(v.de ?? null),
        selectedOptions: Object.entries(v.opcoes).map(([name, value]) => ({ name, value })),
        image: null,
      })),
    },
  };
}

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

function filtrar(q: string | undefined) {
  const termo = (q ?? '').toLowerCase().trim();
  return produtos.filter((p) => !termo || p.title.toLowerCase().includes(termo));
}

/** Página por cursor: o cursor é a posição do item na lista. */
function fatiar<T>(lista: T[], n: number, after: unknown) {
  const inicio = after ? Number(String(after).slice(1)) + 1 : 0;
  const fatia = lista.slice(inicio, inicio + n);
  return { fatia, inicio, hasNextPage: inicio + n < lista.length };
}

export interface OpcoesShopifyFalsa {
  chamadas?: ChamadaShopify[];
  /** A loja não liberou o escopo de estoque no token Storefront. */
  semEscopoDeEstoque?: boolean;
}

export function criarFetchShopify(opcoes: OpcoesShopifyFalsa = {}): typeof fetch {
  return (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const cabecalhos = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const corpo = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables?: Record<string, unknown>; operationName?: string };
    const admin = url.includes('/admin/api/');
    const api = admin ? 'admin' : 'storefront';
    const variaveis = corpo.variables ?? {};
    opcoes.chamadas?.push({ api, url, operacao: corpo.operationName ?? '', variaveis, cabecalhos });

    if (!url.startsWith('https://loja-teste.myshopify.com/')) return json(404, { errors: 'Not Found' });
    if (admin && cabecalhos['X-Shopify-Access-Token'] !== 'adm-certo') return json(401, { errors: '[API] Invalid API key or access token' });
    if (!admin && cabecalhos['X-Shopify-Storefront-Access-Token'] !== 'sf-certo') return json(401, { errors: 'Unauthorized' });

    const comEstoque = corpo.query.includes('quantityAvailable');
    if (comEstoque && opcoes.semEscopoDeEstoque) {
      return json(200, { errors: [{ message: 'Access denied for quantityAvailable field. Required access: `unauthenticated_read_product_inventory` access scope.' }] });
    }

    switch (corpo.operationName) {
      case 'Loja':
      case 'LojaAdmin':
        return json(200, { data: { shop: { name: 'Loja Teste' } } });
      case 'Categorias':
        return json(200, { data: { collections: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: colecoes.map((c) => ({ id: gid('Collection', c.id), title: c.title })) } } });
      case 'Cursores': {
        const { fatia, inicio, hasNextPage } = fatiar(filtrar(variaveis.q as string), variaveis.n as number, variaveis.after);
        return json(200, { data: { products: { pageInfo: { hasNextPage }, edges: fatia.map((_, i) => ({ cursor: `c${inicio + i}` })) } } });
      }
      case 'Produtos': {
        const { fatia, hasNextPage } = fatiar(filtrar(variaveis.q as string), variaveis.n as number, variaveis.after);
        return json(200, { data: { products: { pageInfo: { hasNextPage }, nodes: fatia.map((p) => produtoGql(p, comEstoque)) } } });
      }
      case 'CursoresColecao':
      case 'ProdutosColecao': {
        const id = Number(String(variaveis.id).split('/').pop());
        if (!colecoes.some((c) => c.id === id)) return json(200, { data: { collection: null } });
        const lista = produtos.filter((p) => p.colecoes.includes(id));
        const { fatia, inicio, hasNextPage } = fatiar(lista, variaveis.n as number, variaveis.after);
        const conexao =
          corpo.operationName === 'CursoresColecao'
            ? { pageInfo: { hasNextPage }, edges: fatia.map((_, i) => ({ cursor: `c${inicio + i}` })) }
            : { pageInfo: { hasNextPage }, nodes: fatia.map((p) => produtoGql(p, comEstoque)) };
        return json(200, { data: { collection: { products: conexao } } });
      }
      case 'Produto': {
        const p = produtos.find((x) => x.handle === variaveis.handle);
        return json(200, { data: { product: p ? produtoGql(p, comEstoque) : null } });
      }
      case 'ProdutoPorId': {
        const p = produtos.find((x) => gid('Product', x.id) === variaveis.id);
        return json(200, { data: { product: p ? produtoGql(p, comEstoque) : null } });
      }
      case 'Relacionados':
        return json(200, { data: { productRecommendations: produtos.filter((p) => gid('Product', p.id) !== variaveis.id).map((p) => produtoGql(p, comEstoque)) } });
      case 'SkuAdmin': {
        const sku = String(variaveis.q).replace(/^sku:/, '').replace(/"/g, '');
        const p = produtos.find((x) => x.variantes.some((v) => v.sku === sku));
        return json(200, { data: { productVariants: { nodes: p ? [{ product: { handle: p.handle } }] : [] } } });
      }
      case 'ClienteAdmin': {
        if (variaveis.q !== 'phone:+5538988887777') return json(200, { data: { customers: { nodes: [] } } });
        return json(200, {
          data: {
            customers: {
              nodes: [
                {
                  displayName: 'Ana Souza',
                  email: 'ana@x.com',
                  addresses: [{ address1: 'Rua A, 10', address2: 'Centro', city: 'Montes Claros', provinceCode: 'MG', zip: '39400-000' }],
                  orders: {
                    nodes: [
                      {
                        name: '#1001',
                        createdAt: '2026-09-01T12:00:00Z',
                        totalPriceSet: { shopMoney: { amount: '239.8' } },
                        lineItems: { nodes: [{ title: 'Porcelanato Calacata 60x60', quantity: 2, sku: 'PRC-CAL' }] },
                      },
                    ],
                  },
                },
              ],
            },
          },
        });
      }
      default:
        return json(200, { errors: [{ message: `operação desconhecida: ${corpo.operationName}` }] });
    }
  }) as typeof fetch;
}
