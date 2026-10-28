import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FORMAS_PAGAMENTO, FormaPagamento } from '../contratos/modelo';

/** Endereço vindo do contato da Kentro (pré-cadastro). Tudo opcional: o cliente confere no checkout. */
export class EnderecoContatoDto {
  @IsOptional() @IsString() @MaxLength(9) cep?: string;
  @IsOptional() @IsString() @MaxLength(2) estado?: string;
  @IsOptional() @IsString() @MaxLength(80) cidade?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsString() @MaxLength(120) rua?: string;
  @IsOptional() @IsString() @MaxLength(20) numero?: string;
  @IsOptional() @IsString() @MaxLength(80) complemento?: string;
}

/** O que o link mostra: uma categoria, uma busca ou produtos escolhidos pelo atendente (ou pela IA). */
export class FiltroLinkDto {
  @IsOptional() @IsString() @MaxLength(50) categoriaId?: string;
  @IsOptional() @IsString() @MaxLength(100) busca?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  produtoIds?: string[];
}

export class CriarSessaoDto {
  @IsString()
  @Length(1, 64)
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  documento?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EnderecoContatoDto)
  endereco?: EnderecoContatoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FiltroLinkDto)
  filtro?: FiltroLinkDto;

  /** Com filtro: true (padrão) = o cliente vê só o filtro. */
  @IsOptional()
  @IsBoolean()
  restrito?: boolean;

  /** Ausente = segue a loja. */
  @IsOptional()
  @IsBoolean()
  mostrarPrecos?: boolean;

  /** Carrinho pronto montado pelo atendente. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  itens?: ItemPedidoDto[];
}

export class ItemPedidoDto {
  @IsString()
  @Length(1, 100)
  produtoId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  variacaoId?: string;

  @IsInt()
  @Min(0)
  @Max(100_000)
  quantidade!: number;
}

export class SalvarCarrinhoDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  itens!: ItemPedidoDto[];
}

export class FreteDto {
  @IsString()
  @MaxLength(9)
  cep!: string;
}

export class PagamentoDto {
  @IsIn(FORMAS_PAGAMENTO, { message: 'Escolha a forma de pagamento.' })
  forma!: FormaPagamento;

  /** Dinheiro: a nota com que o cliente vai pagar (ausente ou 0 = não precisa de troco). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Confira o valor do troco.' })
  @Min(0)
  @Max(100_000)
  trocoPara?: number;
}

export class FinalizarDto {
  @IsIn(['entrega', 'retirada'])
  tipo!: 'entrega' | 'retirada';

  @IsOptional()
  @IsObject()
  entrega?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lojaRetiradaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacoes?: string;

  /** Obrigatório quando o pedido é criado na loja (ex.: Nuvemshop pede o e-mail do comprador). */
  @IsOptional()
  @IsEmail({}, { message: 'Confira o e-mail.' })
  @MaxLength(120)
  email?: string;

  /** Obrigatório quando o pedido vai direto para o sistema da loja e é pago ao receber (ex.: ERP da farmácia). */
  @IsOptional()
  @ValidateNested()
  @Type(() => PagamentoDto)
  pagamento?: PagamentoDto;
}
