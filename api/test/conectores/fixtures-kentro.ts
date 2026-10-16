// MCP da Kentro simulado (streamable HTTP, JSON-RPC). Formato dos produtos copiado da instância de teste
// (products_get/products_list, valores em centavos); dados sintéticos.

export const KENTRO_CREDENCIAIS = { url_kentro: 'https://kentro.teste', token_mcp: 'mcp-certo' };

export interface ChamadaMcp {
  metodo: string;
  ferramenta?: string;
  argumentos?: Record<string, unknown>;
  sessao: string | null;
  autorizacao: string;
}

const base = {
  description: '',
  photos: [] as unknown[],
  measurementunit: 'un',
  internalcode: '',
  value: 0,
  saleprice: 0,
  available: 1,
  status: 'active',
  hiddenfromclients: 0,
  qty: 0,
  groups: [] as unknown[],
  currency: 'BRL',
};

// A ordem importa: arquivado e oculto por último (a listagem os descarta).
export const PRODUTOS_KENTRO = [
  { ...base, id: 1, name: 'Porcelanato Bege', description: '<p>Caixa com <b>1,44 m²</b></p>', internalcode: 'PRC-1', measurementunit: 'cx', value: 11990, saleprice: 9990, qty: 10, groups: [1], photos: [{ url: 'https://cdn.kentro.teste/p1.jpg' }] },
  { ...base, id: 2, name: 'Tinta Acrílica', value: 8000, groups: [{ id: 2, name: 'Tintas' }], photos: ['https://cdn.kentro.teste/t.jpg'] },
  { ...base, id: 5, name: 'Rejunte Cinza', value: 5000, available: 0, groups: [1] },
  { ...base, id: 6, name: 'Argamassa AC3', internalcode: 'ARG', value: 3990, qty: 30, groups: [1] },
  { ...base, id: 3, name: 'Produto Arquivado', value: 1000, status: 'archived' },
  { ...base, id: 4, name: 'Produto Oculto', value: 1000, hiddenfromclients: 1 },
];

const GRUPOS = [
  { id: 1, name: 'Pisos', description: '' },
  { id: 2, name: 'Tintas', description: '' },
];

export interface OpcoesMcpFalso {
  chamadas?: ChamadaMcp[];
  /** Responde em text/event-stream em vez de JSON. */
  sse?: boolean;
  /** Esquece as sessões (simula reinício do servidor): a próxima chamada recebe 404. */
  expirar?: { agora: boolean };
}

let sequencia = 0;

export function criarFetchKentro(opcoes: OpcoesMcpFalso = {}): typeof fetch {
  const sessoes = new Set<string>();
  return (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const cabecalhos = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const msg = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    opcoes.chamadas?.push({
      metodo: msg.method,
      ferramenta: msg.params?.name,
      argumentos: msg.params?.arguments,
      sessao: cabecalhos['mcp-session-id'] ?? null,
      autorizacao: cabecalhos.authorization ?? '',
    });

    if (url !== 'https://kentro.teste/mcp') return new Response('não encontrado', { status: 404 });
    if (cabecalhos.authorization !== 'Bearer mcp-certo') return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    if (!String(cabecalhos.accept ?? '').includes('text/event-stream')) return new Response('Accept inválido', { status: 406 });

    const responder = (resultado: unknown, extras: Record<string, string> = {}) => {
      const corpo = { jsonrpc: '2.0', id: msg.id, result: resultado };
      if (opcoes.sse) {
        return new Response(`event: message\ndata: ${JSON.stringify(corpo)}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...extras } });
      }
      return new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json', ...extras } });
    };
    const texto = (dados: unknown) => responder({ content: [{ type: 'text', text: JSON.stringify(dados) }] });

    if (msg.method === 'initialize') {
      sequencia += 1;
      const id = `sessao-${sequencia}`;
      sessoes.add(id);
      return responder({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'omni', version: '1' } }, { 'Mcp-Session-Id': id });
    }
    if (opcoes.expirar?.agora) {
      sessoes.clear();
      opcoes.expirar.agora = false;
    }
    const sessao = cabecalhos['mcp-session-id'];
    if (!sessao || !sessoes.has(sessao)) return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Session not found' } }), { status: 404 });
    if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (msg.method !== 'tools/call') return responder({});

    const args = msg.params?.arguments ?? {};
    switch (msg.params?.name) {
      case 'product_groups_list':
        return texto({ count: GRUPOS.length, groups: GRUPOS });
      case 'products_list': {
        const termo = String(args.search ?? '').toLowerCase();
        const grupo = args.groupId as number | undefined;
        const filtrados = PRODUTOS_KENTRO.filter(
          (p) =>
            (!termo || p.name.toLowerCase().includes(termo) || p.internalcode.toLowerCase().includes(termo)) &&
            (!grupo || p.groups.some((g) => (typeof g === 'object' ? (g as { id: number }).id : g) === grupo)),
        );
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 100);
        const pagina = filtrados.slice(offset, offset + limit).map(({ description: _d, photos: _p, ...resumo }) => resumo);
        return texto({ total: filtrados.length, offset, limit, count: pagina.length, products: pagina });
      }
      case 'products_get': {
        const p = PRODUTOS_KENTRO.find((x) => x.id === Number(args.id));
        if (!p) return responder({ isError: true, content: [{ type: 'text', text: 'Produto não encontrado.' }] });
        return texto(p);
      }
      default:
        return responder({ isError: true, content: [{ type: 'text', text: `Ferramenta desconhecida: ${msg.params?.name}` }] });
    }
  }) as typeof fetch;
}
