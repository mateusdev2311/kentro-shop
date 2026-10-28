import { Categoria, HistoricoCliente, OpcaoFrete, Pagina, PedidoCriado, PedidoParaCriar, Produto, SituacaoPedido } from '../../contratos/modelo';
import { ClienteBanco, MotorBanco } from './banco';

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
  /** Cabeçalhos da resposta, com o nome em minúsculas (ex.: mcp-session-id). */
  cabecalhos?: Record<string, string>;
}

export interface ClienteHttpConector {
  requisitar(req: RequisicaoConector): Promise<RespostaConector>;
}

/** Produto lido da fonte para a cópia sincronizada. */
export interface ProdutoSincronizado {
  produto: Produto;
  /** Texto a mais para a busca, além do nome e do SKU (ex.: código de barras). */
  termos?: string;
  /** EAN, quando a fonte informa: liga o produto à foto do FTP. */
  codigoBarras?: string;
}

export interface CatalogoSincronizado {
  produtos: ProdutoSincronizado[];
  categorias: Categoria[];
}

/** Cópia do catálogo guardada na API (catálogo da Kentro, enviado pela extensão, ou banco de dados do ERP). */
export interface CatalogoLocal {
  estado(): Promise<{ sincronizadoEm: Date | null; total: number }>;
  categorias(): Promise<Categoria[]>;
  produtos(filtro: FiltroProdutos): Promise<Pagina<Produto>>;
  /** Pelo id ou pelo SKU. */
  produto(id: string): Promise<Produto | null>;
}

export interface CtxConector {
  lojaId: string;
  credenciais: Record<string, string>; // já decifradas, só durante a chamada
  http: ClienteHttpConector; // nunca usar fetch direto
  salvarCredenciais(novas: Record<string, string>): Promise<void>; // renovação de token
  /** Só para conectores que leem uma cópia sincronizada em vez da plataforma ao vivo. */
  catalogoLocal?: CatalogoLocal;
  /** Só para conectores de banco de dados: consultas no banco da loja (gravação só em transação, nas tabelas liberadas). */
  banco?: ClienteBanco;
}

export interface ItemCotacao {
  produtoId: string;
  variacaoId?: string;
  sku: string;
  quantidade: number;
}

/** Quem procurar na plataforma: o telefone (com DDI) e o que a Kentro já sabe do contato. */
export interface ConsultaCliente {
  telefone: string;
  email?: string;
  documento?: string;
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
   * Segundos que as leituras do catálogo podem ficar em cache (plataforma com limite de chamadas apertado).
   * Ausente = sem cache. A finalização do pedido sempre lê de novo.
   */
  readonly cacheSegundos?: number;
  /** Conector de banco de dados: o contexto recebe o cliente desse motor (ctx.banco). */
  readonly banco?: { motor: MotorBanco; bancoPadrao?: string };
  /**
   * Catálogo lento demais para ler ao vivo (ex.: view do ERP): a API copia tudo com lerCatalogoCompleto
   * a cada `minutos` e o conector lê a cópia (ctx.catalogoLocal).
   */
  readonly sincronizacao?: { minutos: number };
  /**
   * Fotos num FTP da loja (campos ftp_* entre as credenciais), ligadas ao produto pelo nome do arquivo:
   * EAN ou "cod_" + código interno. Só para conectores com sincronizacao (as fotos vão na cópia).
   */
  readonly fotosFtp?: { minutos: number };
  /**
   * O pedido entra no sistema da loja sem link de pagamento (ex.: ERP): o checkout não pede e-mail, o cliente
   * escolhe a forma de pagamento e paga ao receber ou na retirada.
   */
  readonly pagamentoNaEntrega?: boolean;

  /**
   * Com criarPedido: a loja configurou o que a plataforma exige para receber pedidos (ex.: o código de parceiro
   * do ERP). false = o pedido segue para o atendente. Ausente = sempre pode.
   */
  criaPedido?(credenciais: Record<string, string>): boolean;

  /** Conferência ao salvar, além dos campos obrigatórios. Devolve a mensagem do erro, ou null. */
  validarCredenciais?(credenciais: Record<string, string>): string | null;

  /**
   * Para onde os segredos são enviados, quando isso vem de um campo que não é do tipo url (ex.: domínio da loja).
   * Trocar o destino exige digitar os segredos de novo. Com segredos que vão para lugares diferentes
   * (ex.: senha do banco e senha do FTP), um destino por chave de segredo: só o que mudou é pedido de novo.
   */
  destino?(credenciais: Record<string, string>): string | Record<string, string>;

  testarConexao(ctx: CtxConector): Promise<{ ok: true; nomeLoja?: string } | { ok: false; mensagem: string }>;
  listarCategorias(ctx: CtxConector): Promise<Categoria[]>;
  listarProdutos(ctx: CtxConector, filtro: FiltroProdutos): Promise<Pagina<Produto>>;
  obterProduto(ctx: CtxConector, produtoId: string): Promise<Produto | null>;
  /** Com sincronizacao: o catálogo inteiro, direto da fonte, para trocar a cópia. */
  lerCatalogoCompleto?(ctx: CtxConector): Promise<CatalogoSincronizado>;
  /** Vários produtos numa chamada (conferência do carrinho). Inexistente ou fora de venda: fica de fora do mapa. */
  obterProdutos?(ctx: CtxConector, ids: string[]): Promise<Map<string, Produto>>;
  /** Depois da autorização (OAuth): ex. registrar os webhooks. Falha aqui não desfaz a conexão. */
  aoConectar?(ctx: CtxConector): Promise<void>;
  relacionados?(ctx: CtxConector, produtoId: string): Promise<Produto[]>;
  cotarFrete?(ctx: CtxConector, itens: ItemCotacao[], cep: string): Promise<OpcaoFrete[]>;
  criarPedido?(ctx: CtxConector, pedido: PedidoParaCriar): Promise<PedidoCriado>;
  /** Situação do pedido que criarPedido criou (pelo idExterno dele). */
  situacaoPedido?(ctx: CtxConector, idExterno: string): Promise<SituacaoPedido>;
  /** Cancela o pedido que criarPedido criou, se a plataforma ainda deixa (senão, recusa com o motivo). */
  cancelarPedido?(ctx: CtxConector, idExterno: string): Promise<SituacaoPedido>;
  /** null = a loja não habilitou essa consulta (ex.: Shopify sem o token da Admin API) ou o cliente não existe. */
  historicoDoCliente?(ctx: CtxConector, cliente: ConsultaCliente): Promise<HistoricoCliente | null>;
  /** OAuth: página onde o lojista autoriza. `estado` volta no retorno e identifica a loja. */
  urlDeAutorizacao?(estado: string): string;
  /** OAuth: troca o que veio no retorno (ex.: code) pelas credenciais a gravar. ctx sem credenciais. */
  concluirAutorizacao?(ctx: CtxConector, params: Record<string, string>): Promise<Record<string, string>>;
  /** Id da loja na plataforma, gravado à parte para achar a integração (ex.: webhooks da plataforma). */
  idExterno?(credenciais: Record<string, string>): string | null;
}
