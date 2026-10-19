import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export const PRODUTOS_POR_PARTE = 250;

/** Uma parte da sincronização do catálogo da Kentro (os produtos vêm como o SDK da extensão entrega). */
export class LoteCatalogoKentroDto {
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/, { message: 'Identificador de lote inválido.' })
  lote!: string;

  @IsInt()
  @Min(0)
  @Max(400)
  parte!: number;

  @IsBoolean()
  ultima!: boolean;

  @IsArray()
  @ArrayMaxSize(PRODUTOS_POR_PARTE)
  @IsObject({ each: true })
  produtos!: Record<string, unknown>[];

  /** Nomes dos grupos de produtos ({ id, nome }). Ausente = a Kentro não deu os nomes. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsObject({ each: true })
  grupos?: { id?: unknown; nome?: unknown }[];
}
