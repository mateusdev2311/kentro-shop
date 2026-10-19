// Nuvemshop simulada (API REST 2025-03 e troca do código OAuth). Dados SINTÉTICOS no formato da documentação
// oficial (tiendanube.github.io/api-documentation): ainda não há respostas reais gravadas.
import { BASE_API, URL_TOKEN } from '../../src/conectores/nuvemshop/nuvemshop.conector';

export const NUVEMSHOP_CREDENCIAIS = { access_token: 'tok-certo', store_id: '123' };
export const APP_TESTE = { appId: '47447', clientSecret: 'segredo-do-app', userAgent: 'Kentro Shop (https://shop.teste)' };

export interface ChamadaNuvemshop {
  metodo: string;
  url: string;
  cabecalhos: Record<string, string>;
  corpo?: unknown;
}

export const PRODUTOS_NUVEMSHOP = [
  {
    id: 101,
    name: { pt: 'Porcelanato Calacata 60x60', es: 'Porcelanato Calacata' },
    description: { pt: '<p>Caixa com <b>1,44 m²</b></p>' },
    canonical_url: 'https://loja-teste.lojavirtualnuvem.com.br/produtos/calacata/',
    published: true,
    attributes: [],
    categories: [{ id: 11 }],
    images: [{ id: 1, src: 'https://d26lpennugtm8s.cloudfront.net/calacata.jpg', position: 1 }],
    variants: [{ id: 1001, price: '129.90', promotional_price: '119.90', stock_management: true, stock: 10, sku: 'PRC-CAL', values: [] }],
  },
  {
    id: 102,
    name: { es: 'Pintura Acrílica' }, // sem português: cai para o espanhol
    description: { pt: '' },
    published: true,
    attributes: [{ pt: 'Cor' }],
    categories: [{ id: 12 }],
    images: [{ id: 2, src: 'http://d26lpennugtm8s.cloudfront.net/tinta.jpg', position: 1 }],
    variants: [
      { id: 1002, price: '80.00', promotional_price: null, stock_management: true, stock: 5, sku: 'TNT-BR', values: [{ pt: 'Branco' }], image_id: 2 },
      { id: 1003, price: '90.00', promotional_price: null, stock_management: true, stock: 0, sku: 'TNT-PR', values: [{ pt: 'Preto' }] },
    ],
  },
  {
    id: 103,
    name: { pt: 'Argamassa AC3' },
    description: { pt: 'Saco de 20 kg' },
    published: true,
    attributes: [],
    categories: [{ id: 11 }],
    images: [],
    variants: [{ id: 1004, price: '39.90', promotional_price: '0.00', stock_management: false, stock: null, sku: 'ARG', values: [] }],
  },
  {
    id: 104,
    name: { pt: 'Produto Despublicado' },
    published: false,
    attributes: [],
    categories: [],
    images: [],
    variants: [{ id: 1005, price: '10.00', stock_management: false, sku: 'OFF', values: [] }],
  },
];

const CATEGORIAS = [
  { id: 11, name: { pt: 'Pisos' }, parent: null },
  { id: 12, name: { pt: 'Tintas' }, parent: 0 },
];

const resposta = (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...cabecalhos } }));

export function criarFetchNuvemshop(chamadas: ChamadaNuvemshop[] = []): typeof fetch {
  return ((url: string, init: RequestInit = {}) => {
    const cabecalhos = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const corpo = init.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ metodo: init.method ?? 'GET', url, cabecalhos, corpo });

    if (url === URL_TOKEN) {
      // A Nuvemshop responde 200 com "error" quando o código venceu ou já foi usado.
      if (corpo?.code !== 'codigo-certo' || corpo?.client_secret !== APP_TESTE.clientSecret) {
        return resposta(200, { error: 'invalid_grant', error_description: 'The authorization code is invalid' });
      }
      return resposta(200, { access_token: 'tok-certo', token_type: 'bearer', scope: 'read_products', user_id: 123 });
    }

    if (!cabecalhos['User-Agent']) return resposta(400, { code: 400, message: 'Bad Request', description: 'User-Agent required' });
    const u = new URL(url);
    const prefixo = `${new URL(BASE_API).pathname}/123`;
    if (!u.pathname.startsWith(prefixo)) return resposta(404, { code: 404, message: 'Not Found' });
    if (cabecalhos.Authorization !== 'Bearer tok-certo') return resposta(401, { code: 401, message: 'Unauthorized' });
    const caminho = u.pathname.slice(prefixo.length);

    if (caminho === '/store') return resposta(200, { id: 123, name: { pt: 'Loja Nuvem Teste' } });
    if (caminho === '/categories') return Number(u.searchParams.get('page') ?? 1) > 1 ? resposta(404, { description: 'Last page is 1' }) : resposta(200, CATEGORIAS);

    if (caminho === '/products') {
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      const categoria = u.searchParams.get('category_id');
      const lista = PRODUTOS_NUVEMSHOP.filter(
        (p) =>
          (u.searchParams.get('published') !== 'true' || p.published) &&
          (!q || JSON.stringify(p.name).toLowerCase().includes(q)) &&
          (!categoria || p.categories.some((c) => String(c.id) === categoria)),
      );
      const porPagina = Number(u.searchParams.get('per_page') ?? 30);
      const pagina = Number(u.searchParams.get('page') ?? 1);
      const itens = lista.slice((pagina - 1) * porPagina, pagina * porPagina);
      // Como a Nuvemshop: página depois da última (ou busca sem nada) responde 404.
      if (!itens.length) return resposta(404, { code: 404, message: 'Not Found', description: 'Last page is 0' });
      return resposta(200, itens, { 'x-total-count': String(lista.length) });
    }

    const porSku = caminho.match(/^\/products\/sku\/(.+)$/);
    if (porSku) {
      const sku = decodeURIComponent(porSku[1]);
      const p = PRODUTOS_NUVEMSHOP.find((x) => x.variants.some((v) => v.sku === sku));
      return p ? resposta(200, p) : resposta(404, { code: 404, message: 'Not Found' });
    }
    const porId = caminho.match(/^\/products\/(\d+)$/);
    if (porId) {
      const p = PRODUTOS_NUVEMSHOP.find((x) => String(x.id) === porId[1]);
      return p ? resposta(200, p) : resposta(404, { code: 404, message: 'Not Found' });
    }
    return resposta(404, { code: 404, message: 'Not Found' });
  }) as typeof fetch;
}
