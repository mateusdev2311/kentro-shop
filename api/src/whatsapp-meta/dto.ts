import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const ID_META = /^\d{5,30}$/;
const MENSAGEM_ID = 'Use só os números do ID, como aparecem na Meta.';

export class SalvarWhatsappMetaDto {
  @IsString() @Matches(ID_META, { message: MENSAGEM_ID }) wabaId!: string;
  @IsString() @Matches(ID_META, { message: MENSAGEM_ID }) telefoneId!: string;
  /** Vazio mantém o token já gravado. */
  @IsOptional() @IsString() @MaxLength(1000) token?: string;
}

export class EnviarCarrosselDto {
  @IsString() @Length(1, 64) chatId!: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsString() @MaxLength(120) nome?: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'O carrossel precisa de 2 a 10 produtos.' })
  @ArrayMaxSize(10, { message: 'O carrossel precisa de 2 a 10 produtos.' })
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  produtoIds!: string[];
}
