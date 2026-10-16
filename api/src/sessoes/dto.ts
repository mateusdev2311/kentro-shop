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
