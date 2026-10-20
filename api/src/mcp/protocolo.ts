// Servidor MCP mínimo no transporte "streamable HTTP", sem estado (spec 11.1): cada POST traz uma mensagem
// JSON-RPC (ou um lote) e a resposta sai em JSON puro. Não há sessão nem canal de notificações (GET /mcp → 405).

export const VERSOES_SUPORTADAS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface DefinicaoFerramenta {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export interface ResultadoFerramenta {
  texto: string;
  erro?: boolean;
}

export interface ServidorMcp {
  nome: string;
  versao: string;
  instrucoes: string;
  ferramentas: DefinicaoFerramenta[];
  chamar(nome: string, args: Record<string, unknown>): Promise<ResultadoFerramenta>;
}

type Id = string | number;

interface Resposta {
  jsonrpc: '2.0';
  id: Id | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const ERRO_REQUISICAO = -32600;
export const ERRO_METODO = -32601;
export const ERRO_PARAMETROS = -32602;

const erro = (id: Id | null, code: number, message: string): Resposta => ({ jsonrpc: '2.0', id, error: { code, message } });

const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Responde uma mensagem. Notificação (sem id) não tem resposta: devolve null. */
export async function responder(servidor: ServidorMcp, mensagem: unknown): Promise<Resposta | null> {
  if (!objeto(mensagem) || mensagem.jsonrpc !== '2.0' || typeof mensagem.method !== 'string') {
    const id = objeto(mensagem) && (typeof mensagem.id === 'string' || typeof mensagem.id === 'number') ? mensagem.id : null;
    // Resposta do cliente a um pedido do servidor (nunca fazemos pedidos): ignora.
    if (objeto(mensagem) && !('method' in mensagem) && ('result' in mensagem || 'error' in mensagem)) return null;
    return erro(id, ERRO_REQUISICAO, 'Requisição JSON-RPC inválida.');
  }
  if (!('id' in mensagem) || mensagem.id === undefined) return null;
  const id = mensagem.id;
  if (typeof id !== 'string' && typeof id !== 'number') return erro(null, ERRO_REQUISICAO, 'id inválido.');
  const params = objeto(mensagem.params) ? mensagem.params : {};

  switch (mensagem.method) {
    case 'initialize': {
      const pedida = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: VERSOES_SUPORTADAS.includes(pedida) ? pedida : VERSOES_SUPORTADAS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: servidor.nome, version: servidor.versao },
          instructions: servidor.instrucoes,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: servidor.ferramentas } };
    case 'tools/call': {
      const nome = typeof params.name === 'string' ? params.name : '';
      if (!servidor.ferramentas.some((f) => f.name === nome)) return erro(id, ERRO_PARAMETROS, `Ferramenta desconhecida: ${nome || '(sem nome)'}.`);
      const args = objeto(params.arguments) ? params.arguments : {};
      const r = await servidor.chamar(nome, args);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.texto }], isError: !!r.erro } };
    }
    default:
      return erro(id, ERRO_METODO, `Método não suportado: ${mensagem.method}.`);
  }
}

/** Lote (array) ou mensagem única. null = nada a responder (só notificações). */
export async function responderCorpo(servidor: ServidorMcp, corpo: unknown): Promise<Resposta | Resposta[] | null> {
  if (Array.isArray(corpo)) {
    if (!corpo.length) return erro(null, ERRO_REQUISICAO, 'Lote vazio.');
    const respostas: Resposta[] = [];
    for (const m of corpo) {
      const r = await responder(servidor, m);
      if (r) respostas.push(r);
    }
    return respostas.length ? respostas : null;
  }
  return responder(servidor, corpo);
}
