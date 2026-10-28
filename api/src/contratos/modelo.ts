// Modelo de domínio do Kentro Shop (spec, seção 6). Toda plataforma de e-commerce é normalizada para estes tipos.

export interface Produto {
  id: string; // id na plataforma
  sku: string;
  nome: string;
  descricao: string; // texto puro (sanitizado)
  descricaoCurta?: string;
  imagens: string[]; // URLs absolutas HTTPS
  preco: number; // preço vigente (já com promoção)
  precoDe?: number; // preço "de" quando há promoção
  unidade: string; // "UN", "CX", "M2", "KG"...
  estoque: number | null; // null = plataforma não controla
  disponivel: boolean;
  categoriaIds: string[];
  urlNaLoja?: string;
  variacoes: Variacao[]; // vazio = produto simples
  atributosVariacao?: string[]; // ex.: ["Cor", "Tamanho"]
  /** Regras da loja aplicadas por cima do produto ao vivo (spec 7.4). */
  regras?: RegrasAplicadas;
}

export interface RegrasAplicadas {
  selo?: string;
  m2PorUnidade?: number;
  rendimentoM2?: number;
  compreJunto: string[];
}

export interface Variacao {
  id: string;
  sku: string;
  nome: string; // ex.: "Azul / G"
  atributos: Record<string, string>; // { Cor: "Azul", Tamanho: "G" }
  preco: number;
  precoDe?: number;
  estoque: number | null;
  disponivel: boolean;
  imagem?: string;
  /** Cores para a amostra do chip de variação (ex.: ["#c9a27a", "#a67c52"]). */
  cores?: string[];
}

export interface Categoria {
  id: string;
  nome: string;
  paiId?: string;
  ordem?: number;
}

export interface Pagina<T> {
  itens: T[];
  pagina: number;
  porPagina: number;
  total?: number;
  temMais: boolean;
}

export interface OpcaoFrete {
  id: string;
  titulo: string;
  prazo?: string;
  valor: number;
}

export interface Endereco {
  cep: string;
  estado: string;
  cidade: string;
  bairro: string;
  rua: string;
  numero: string;
  complemento?: string;
  referencia?: string;
}

/** O que a plataforma sabe de um cliente pelo telefone (endereços e últimos pedidos). */
export interface HistoricoCliente {
  nome: string;
  email?: string;
  enderecos: Endereco[];
  pedidos: {
    numero: string;
    data: string; // ISO 8601
    total: number;
    /** produtoId/variacaoId permitem "pedir de novo" (quando a plataforma informa). */
    itens: { sku: string; nome: string; quantidade: number; produtoId?: string; variacaoId?: string }[];
  }[];
}

/** Como o cliente paga quando o pedido vai direto para o sistema da loja e é pago ao receber. */
export const FORMAS_PAGAMENTO = ['dinheiro', 'cartao', 'pix'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export interface PagamentoNaEntrega {
  forma: FormaPagamento;
  /** Só no dinheiro: a nota com que o cliente vai pagar (ausente = não precisa de troco). */
  trocoPara?: number;
}

export interface PedidoParaCriar {
  cliente: { nome: string; telefone: string; email?: string; documento?: string };
  entrega: { tipo: 'entrega' | 'retirada'; endereco?: Endereco; lojaRetiradaId?: string };
  itens: { produtoId: string; variacaoId?: string; sku: string; nome?: string; quantidade: number; precoUnitario: number }[];
  frete?: { titulo: string; valor: number };
  desconto?: { valor: number; motivo: string };
  /** Conector com pagamentoNaEntrega: a forma que o cliente escolheu no checkout. */
  pagamento?: PagamentoNaEntrega;
  observacoes?: string;
  referenciaExterna: string; // id da sessão Kentro Shop
}

export interface PedidoCriado {
  idExterno: string;
  numero: string;
  url?: string;
  status: string;
}

/** Como o pedido está na plataforma agora (ex.: em separação na loja). */
export interface SituacaoPedido {
  /** Como a plataforma chama (ex.: EM SEPARACAO). */
  status: string;
  /** Para o atendente ler (ex.: "Em separação"). */
  descricao: string;
  /** Ainda dá para cancelar pelo Kentro Shop. */
  cancelavel: boolean;
}
