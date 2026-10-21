// Formatos que o catálogo recebe da API (rotas /v1/catalogo/:token). O modelo de produto é o mesmo da API.
export type { Categoria, Pagina, Produto, Variacao } from '../../api/src/contratos/modelo';

export interface LojaRetirada {
  id: string;
  nome: string;
  endereco: string;
  horario: string;
  orientacoes: string;
}

export type RegraFrete =
  | { regra: 'a_combinar'; prazo?: string }
  | { regra: 'fixo'; valor: number; prazo?: string }
  | { regra: 'gratis_acima_de'; valor: number; minimo: number; prazo?: string };

export interface DadosEntrega {
  nome: string;
  telefone: string;
  cep: string;
  estado: string;
  cidade: string;
  bairro: string;
  rua: string;
  numero: string;
  complemento: string;
  referencia: string;
}

export type Checkout =
  | { tipo: 'entrega'; entrega: DadosEntrega; observacoes: string }
  | { tipo: 'retirada'; loja: LojaRetirada; observacoes: string };

export interface Totais {
  itens: number;
  subtotal: number;
  /** null = frete a combinar */
  frete: number | null;
  desconto: number;
  total: number;
}

export interface ItemSessao {
  produtoId: string;
  variacaoId: string | null;
  sku: string;
  nome: string;
  variacaoNome: string | null;
  imagem: string | null;
  unidade: string;
  precoUnitario: number;
  quantidade: number;
  subtotal: number;
  m2: number | null;
}

/** Pré-cadastro: o que a Kentro já sabe do contato (o cliente confere no checkout). */
export interface Cliente {
  nome: string;
  telefone: string;
  email?: string;
  documento?: string;
  endereco?: Partial<Pick<DadosEntrega, 'cep' | 'estado' | 'cidade' | 'bairro' | 'rua' | 'numero' | 'complemento'>>;
}

export type StatusSessao = 'link_enviado' | 'navegando' | 'finalizado' | 'pedido_criado' | 'expirado';

/** Pedido criado na loja ao finalizar: número e link de pagamento. */
export interface PedidoNaLoja {
  numero: string;
  url?: string;
  status: string;
}

export interface Sessao {
  id: string;
  /** Ausente ou null = o atendente fecha a venda. */
  pedido?: PedidoNaLoja | null;
  status: StatusSessao;
  url: string;
  cliente: Cliente;
  itens: ItemSessao[];
  totais: Totais;
  checkout: Checkout | null;
  abertaEm: string | null;
  finalizadaEm: string | null;
  expiraEm: string;
}

export interface Tema {
  nome: string;
  corPrimaria: string;
  /** Cor da faixa do topo (padrão: grafite). */
  corTopo?: string;
  layout?: 'grade' | 'lista';
  /** Faixa de boas-vindas no alto da vitrine (padrão: ligada). */
  destaque?: boolean;
  logoUrl?: string;
  boasVindas?: string;
  /** Título da faixa de boas-vindas (ausente = o padrão do catálogo). */
  tituloDestaque?: string;
  // Opcionais: a API sempre manda, mas o catálogo também abre com uma API anterior (padrões no lugar).
  fonte?: 'classica' | 'moderna' | 'elegante' | 'arredondada' | 'forte' | 'simples';
  cantos?: 'arredondados' | 'suaves' | 'retos';
  imagemProduto?: 'quadrada' | 'retrato';
  /** Sugestões "Compre também" no fim da vitrine de um link (padrão: ligadas). */
  compreTambem?: boolean;
  banners?: Banner[];
  /** Tempo de cada banner no carrossel (padrão: 5). */
  bannerSegundos?: number;
}

export interface Banner {
  id: string;
  url: string;
  titulo?: string;
  /** Ao tocar: abre esta categoria ou esta busca. */
  categoriaId?: string;
  busca?: string;
}

export interface EnderecoSalvo {
  cep: string;
  estado: string;
  cidade: string;
  bairro: string;
  rua: string;
  numero: string;
  complemento: string;
  referencia: string;
}

export interface PedidoAnterior {
  data: string;
  total: number;
  itens: { produtoId: string; variacaoId: string | null; sku: string; nome: string; variacaoNome: string | null; quantidade: number }[];
}

export interface Abertura {
  sessao: Sessao;
  /** O pedido é criado na loja (ex.: Nuvemshop): o checkout pede o e-mail e termina no link de pagamento. */
  pedidoNaLoja?: boolean;
  /** Endereços e pedidos anteriores do mesmo telefone nesta loja. */
  historico: { enderecos: EnderecoSalvo[]; pedidos: PedidoAnterior[] };
  /** Link montado pelo atendente (categoria, busca ou produtos escolhidos). */
  filtro: { categoriaId?: string; busca?: string; produtoIds?: string[] } | null;
  /** Com filtro: true = o cliente vê só o filtro. */
  restrito: boolean;
  /** false = catálogo sem preço (a API já manda os valores zerados). */
  mostrarPrecos: boolean;
  tema: Tema;
  entrega: { habilitada: boolean };
  retirada: { habilitada: boolean; lojas: LojaRetirada[] };
  frete: RegraFrete;
}

export interface CotacaoFrete {
  titulo: string;
  valor: number | null;
  prazo?: string;
}

export interface Diferenca {
  sku: string;
  nome: string;
  /** Sem preço na tela, a diferença vem só com a quantidade. */
  antes: { preco?: number; quantidade: number };
  /** null = saiu do carrinho */
  depois: { preco?: number; quantidade: number } | null;
}

export interface PedidoDeItem {
  produtoId: string;
  variacaoId?: string;
  quantidade: number;
}

export type CorpoFinalizar = (
  | { tipo: 'entrega'; entrega: DadosEntrega; observacoes: string }
  | { tipo: 'retirada'; lojaRetiradaId: string; observacoes: string }
) & { email?: string };

export const pedidoAberto = (s: Sessao | null) => !s || s.status === 'link_enviado' || s.status === 'navegando';
