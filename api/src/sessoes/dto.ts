import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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
}
