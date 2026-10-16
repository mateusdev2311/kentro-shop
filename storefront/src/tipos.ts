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

export interface Sessao {
  id: string;
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
  logoUrl?: string;
  boasVindas?: string;
}

export interface Abertura {
  sessao: Sessao;
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
  antes: { preco: number; quantidade: number };
  /** null = saiu do carrinho */
  depois: { preco: number; quantidade: number } | null;
}

export interface PedidoDeItem {
  produtoId: string;
  variacaoId?: string;
  quantidade: number;
}

export type CorpoFinalizar =
  | { tipo: 'entrega'; entrega: DadosEntrega; observacoes: string }
  | { tipo: 'retirada'; lojaRetiradaId: string; observacoes: string };

export const pedidoAberto = (s: Sessao | null) => !s || s.status === 'link_enviado' || s.status === 'navegando';
