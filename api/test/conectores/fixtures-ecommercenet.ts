import * as fixtures from './fixtures/ecommercenet.json';

// fetch falso que responde com as respostas gravadas da eCommerce-net.

export const ECN_URL = 'https://lojateste.ecommercenet.com.br/api/';
export const ECN_CREDENCIAIS = { url_api: ECN_URL, client_id: 'id-teste', client_secret: 'segredo-teste' };
export const ECN_AUTORIZACAO = Buffer.from('id-teste:segredo-teste').toString('base64');

type Gravada = { status: number; corpo: unknown };
const F = fixtures as unknown as Record<string, Gravada>;

function responder(g: Gravada): Response {
  return new Response(JSON.stringify(g.corpo), { status: g.status, headers: { 'Content-Type': 'application/json' } });
}

export interface ChamadaEcn {
  caminho: string;
  query: URLSearchParams;
  autorizacao: string | null;
}

export function criarFetchEcn(chamadas: ChamadaEcn[] = [], sobrescrever: Record<string, Gravada> = {}): typeof fetch {
  return ((entrada: string, init: RequestInit) => {
    const url = new URL(entrada);
    const caminho = url.pathname.replace(/^\/api/, '');
    const autorizacao = new Headers(init.headers).get('Authorization');
    chamadas.push({ caminho, query: url.searchParams, autorizacao });
    const fixturas = { ...F, ...sobrescrever };
    if (autorizacao !== ECN_AUTORIZACAO) return Promise.resolve(responder(fixturas['credencial-invalida']));
    const q = url.searchParams;
    switch (caminho) {
      case '/category/findbyname':
        return Promise.resolve(responder(fixturas.categorias));
      case '/product/all':
        if (q.get('search') === 'zzzzzz') return Promise.resolve(responder(fixturas['busca-vazia']));
        if (q.get('search')) return Promise.resolve(responder(fixturas.busca));
        return Promise.resolve(responder(fixturas[q.get('page') === '2' ? 'produtos-p2' : 'produtos-p1']));
      case '/product/findBySku':
        if (q.get('sku') === 'PRC-6060-CAL') return Promise.resolve(responder(fixturas['produto-simples']));
        if (q.get('sku') === 'VNL-CARV') return Promise.resolve(responder(fixturas['produto-variacao']));
        // Conforme o OpenAPI: SKU inexistente responde 400 com "Product not found".
        return Promise.resolve(new Response('{"success":false,"errors":["Product not found"],"data":{}}', { status: 400 }));
      case '/product/findvarietybyproductskuv2':
        return Promise.resolve(responder(fixturas.variacoes));
      case '/product/findbuyitwithbysku':
        return Promise.resolve(responder(fixturas['compre-junto']));
      case '/product/findRelatedBySku':
        return Promise.resolve(responder(fixturas.relacionados));
      default:
        return Promise.resolve(new Response('{}', { status: 404 }));
    }
  }) as unknown as typeof fetch;
}
