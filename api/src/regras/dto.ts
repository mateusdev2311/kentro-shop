import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** Campos ausentes mantêm o valor gravado; null limpa. */
export class RegraDto {
  @IsOptional()
  @IsBoolean()
  oculto?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  selo?: string | null;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  m2PorUnidade?: number | null;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  rendimentoM2?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  compreJunto?: string[] | null;
}
