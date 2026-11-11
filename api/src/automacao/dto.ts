import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

// A URA manda as variáveis da Kentro como vierem: {{chat_id}} pode chegar como número.
const comoTexto = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);

export class LinkAutomacaoDto {
  @Transform(comoTexto)
  @IsString()
  @Length(1, 64)
  chatId!: string;

  @IsOptional() @Transform(comoTexto) @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @Transform(comoTexto) @IsString() @MaxLength(30) telefone?: string;

  /** Opcional: o link abre nesta categoria. Com categoria ou busca, cada chamada gera um link novo (mesmo carrinho). */
  @IsOptional() @Transform(comoTexto) @IsString() @MaxLength(50) categoriaId?: string;
  @IsOptional() @IsString() @MaxLength(100) busca?: string;
}
