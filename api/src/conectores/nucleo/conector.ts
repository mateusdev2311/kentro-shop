import { Categoria, HistoricoCliente, OpcaoFrete, Pagina, PedidoCriado, PedidoParaCriar, Produto } from '../../contratos/modelo';

// Interface única dos conectores (spec 7.1). Adicionar uma plataforma = implementar isto e registrar.

export interface Capacidades {
  buscaTextual: boolean;
  categorias: boolean;
  variacoes: boolean;
  estoque: boolean;
  relacionados: boolean;
  cotarFrete: boolean;
  criarPedido: boolean;
  oauth: boolean;
  /** Endereços e pedidos anteriores do cliente pelo telefone. */
  historicoCliente: boolean;
}

export interface CampoCredencial {
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'url' | 'select';
  obrigatorio: boolean;
  ajuda?: string;
  opcoes?: { valor: string; rotulo: string }[];
}

export interface RequisicaoConector {
  metodo: 'GET' | 'POST';
  url: string;
  /** Nome curto da operação, usado no registro de chamadas (nunca a URL). */
  operacao: string;
  cabecalhos?: Record<string, string>;
  corpo?: unknown;
}

export interface RespostaConector {
  status: number;
  corpo: unknown;
}

export interface ClienteHttpConector {
  requisitar(req: RequisicaoConector): Promise<RespostaConector>;
}

export interface CtxConector {
  lojaId: string;
  credenciais: Record<string, string>; // já decifradas, só durante a chamada
  http: ClienteHttpConector; // nunca usar fetch direto
  salvarCredenciais(novas: Record<string, string>): Promise<void>; // renovação de token
}

export interface ItemCotacao {
  produtoId: string;
  variacaoId?: string;
  sku: string;
  quantidade: number;
}

export interface FiltroProdutos {
  busca?: string;
  categoriaId?: string;
  pagina: number;
  porPagina: number;
}

export interface Conector {
  readonly id: string;
  readonly nome: string;
  readonly capacidades: Capacidades;
  readonly camposDeCredencial: CampoCredencial[];
  /** Ritmo de requisições por loja (token bucket). */
  readonly ritmo: { porSegundo: number; rajada: number };

  /**
   * Para onde os segredos são enviados, quando isso vem de um campo que não é do tipo url (ex.: domínio da loja).
   * Trocar o destino exige digitar os segredos de novo.
   */
  destino?(credenciais: Record<string, string>): string;

  testarConexao(ctx: CtxConector): Promise<{ ok: true; nomeLoja?: string } | { ok: false; mensagem: string }>;
  listarCategorias(ctx: CtxConector): Promise<Categoria[]>;
  listarProdutos(ctx: CtxConector, filtro: FiltroProdutos): Promise<Pagina<Produto>>;
  obterProduto(ctx: CtxConector, produtoId: string): Promise<Produto | null>;
  relacionados?(ctx: CtxConector, produtoId: string): Promise<Produto[]>;
  cotarFrete?(ctx: CtxConector, itens: ItemCotacao[], cep: string): Promise<OpcaoFrete[]>;
  criarPedido?(ctx: CtxConector, pedido: PedidoParaCriar): Promise<PedidoCriado>;
  /** null = a loja não habilitou essa consulta (ex.: Shopify sem o token da Admin API) ou o cliente não existe. */
  historicoDoCliente?(ctx: CtxConector, telefone: string): Promise<HistoricoCliente | null>;
  urlDeAutorizacao?(ctx: CtxConector, urlRetorno: string): string;
  concluirAutorizacao?(ctx: CtxConector, params: Record<string, string>): Promise<Record<string, string>>;
}
