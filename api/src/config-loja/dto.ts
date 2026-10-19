import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TIPOS_DE_LOGO } from './config-loja.service';

const COR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MENSAGEM_COR = 'Use uma cor no formato #RRGGBB.';

export class TemaDto {
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @IsString() @Matches(COR, { message: MENSAGEM_COR }) corPrimaria?: string;
  @IsOptional() @IsString() @Matches(/^$|^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: MENSAGEM_COR }) corTopo?: string;
  @IsOptional() @IsIn(['grade', 'lista']) layout?: 'grade' | 'lista';
  @IsOptional() @IsBoolean() destaque?: boolean;
  @IsOptional() @IsString() @MaxLength(200) boasVindas?: string;
}

export class LigadoDto {
  @IsBoolean() habilitada!: boolean;
}

export class LojaRetiradaDto {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,40}$/) id?: string;
  @IsString() @Length(1, 80) nome!: string;
  @IsString() @Length(1, 160) endereco!: string;
  @IsOptional() @IsString() @MaxLength(80) horario?: string;
  @IsOptional() @IsString() @MaxLength(200) orientacoes?: string;
}

export class ConfigFreteDto {
  @IsIn(['a_combinar', 'fixo', 'gratis_acima_de']) regra!: 'a_combinar' | 'fixo' | 'gratis_acima_de';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000) valor?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) minimo?: number;
  @IsOptional() @IsString() @MaxLength(80) prazo?: string;
}

export class AtualizarConfigDto {
  @IsOptional() @ValidateNested() @Type(() => TemaDto) tema?: TemaDto;
  @IsOptional() @ValidateNested() @Type(() => LigadoDto) entrega?: LigadoDto;
  @IsOptional() @ValidateNested() @Type(() => LigadoDto) retirada?: LigadoDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LojaRetiradaDto)
  lojasRetirada?: LojaRetiradaDto[];

  @IsOptional() @ValidateNested() @Type(() => ConfigFreteDto) frete?: ConfigFreteDto;
  @IsOptional() @IsInt() @Min(1) @Max(60) expiracaoLinkDias?: number;
  @IsOptional() @IsBoolean() mostrarPrecos?: boolean;
  @IsOptional() @IsIn(['handoff', 'criar_pedido']) modoPedido?: 'handoff' | 'criar_pedido';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  categoriasOcultas?: string[];
}

export class LogoDto {
  @IsIn(TIPOS_DE_LOGO as unknown as string[], { message: 'Envie o logo em PNG, JPG ou WebP.' }) tipo!: string;
  // O tamanho real (300 KB) é conferido depois de decodificar, com mensagem clara; aqui só um teto.
  @IsString() @MaxLength(580_000) base64!: string;
}
