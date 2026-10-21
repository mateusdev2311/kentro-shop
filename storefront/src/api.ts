import type {
  Abertura,
  Categoria,
  CorpoFinalizar,
  CotacaoFrete,
  Diferenca,
  Pagina,
  PedidoDeItem,
  Produto,
  Sessao,
} from './tipos';

export interface ErroDaApi {
  status: number; // 0 = sem conexão
  codigo: string;
  mensagem: string;
  diferencas?: Diferenca[];
  sessao?: Sessao;
}

export const ehErroDaApi = (e: unknown): e is ErroDaApi => !!e && typeof e === 'object' && 'codigo' in e && 'mensagem' in e;

const SEM_CONEXAO: ErroDaApi = { status: 0, codigo: 'SEM_CONEXAO', mensagem: 'Sem conexão. Verifique a internet e tente de novo.' };

export type Api = ReturnType<typeof criarApi>;

export function criarApi(token: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
  const base = `/v1/catalogo/${encodeURIComponent(token)}`;

  async function pedir<T>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetchFn(base + caminho, {
        method: metodo,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw SEM_CONEXAO;
    }
    const dados = await resposta.json().catch(() => null);
    if (resposta.ok) return dados as T;
    const erro = dados?.erro;
    throw {
      status: resposta.status,
      codigo: erro?.codigo ?? 'ERRO',
      mensagem: erro?.mensagem ?? 'Não foi possível concluir. Tente de novo.',
      ...(dados?.diferencas ? { diferencas: dados.diferencas } : {}),
      ...(dados?.sessao ? { sessao: dados.sessao } : {}),
    } satisfies ErroDaApi;
  }

  return {
    abrir: () => pedir<Abertura>('/abrir'),
    categorias: () => pedir<Categoria[]>('/categorias'),
    produtos: (filtro: { busca?: string; categoria?: string; pagina?: number; selecao?: boolean } = {}) => {
      const q = new URLSearchParams();
      if (filtro.busca) q.set('busca', filtro.busca);
      if (filtro.categoria) q.set('categoria', filtro.categoria);
      if (filtro.pagina && filtro.pagina > 1) q.set('pagina', String(filtro.pagina));
      if (filtro.selecao) q.set('selecao', '1');
      const s = q.toString();
      return pedir<Pagina<Produto>>(`/produtos${s ? `?${s}` : ''}`);
    },
    produto: (id: string) => pedir<Produto>(`/produtos/${encodeURIComponent(id)}`),
    sugestoes: () => pedir<Produto[]>('/sugestoes'),
    salvarCarrinho: (itens: PedidoDeItem[]) => pedir<{ sessao: Sessao; avisos: string[] }>('/carrinho', 'PUT', { itens }),
    frete: (cep: string) => pedir<CotacaoFrete>('/frete', 'POST', { cep }),
    finalizar: (corpo: CorpoFinalizar) => pedir<Sessao>('/finalizar', 'POST', corpo),
  };
}
