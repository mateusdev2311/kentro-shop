import { LojaRetirada } from '../config-loja/config-loja.service';

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

export interface EnderecoContato {
  cep?: string;
  estado?: string;
  cidade?: string;
  bairro?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
}

/** Dados do cliente. Além de nome e telefone, o pré-cadastro traz o que a Kentro já sabe do contato. */
export interface Cliente {
  nome: string;
  telefone: string;
  email?: string;
  documento?: string;
  endereco?: EnderecoContato;
}

export interface ItemPublico {
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

export interface EventoPublico {
  em: string;
  texto: string;
  autor: 'cliente' | 'atendente' | 'sistema' | 'ia';
}

export type StatusSessao = 'link_enviado' | 'navegando' | 'finalizado' | 'pedido_criado' | 'expirado';

/** O que o painel do atendente recebe. */
export interface SessaoCompleta {
  id: string;
  status: StatusSessao;
  url: string;
  cliente: Cliente;
  itens: ItemPublico[];
  totais: Totais;
  checkout: Checkout | null;
  eventos: EventoPublico[];
  resumo: string;
  abertaEm: string | null;
  finalizadaEm: string | null;
  expiraEm: string;
  /** Link com filtro (null = catálogo todo). */
  filtro: FiltroLink | null;
  restrito: boolean;
  /** null = segue a loja. */
  mostrarPrecos: boolean | null;
  /** Pedido criado na loja ao finalizar (modo "criar pedido"); null = o atendente fecha a venda. */
  pedido: PedidoNaLoja | null;
}

export interface PedidoNaLoja {
  idExterno: string;
  numero: string;
  /** Link de pagamento (checkout da plataforma). */
  url?: string;
  status: string;
}

export interface FiltroLink {
  categoriaId?: string;
  busca?: string;
  produtoIds?: string[];
}

/** O que o catálogo do cliente recebe (sem a atividade e sem o resumo do atendente). */
export type SessaoPublica = Omit<SessaoCompleta, 'eventos' | 'resumo'>;
