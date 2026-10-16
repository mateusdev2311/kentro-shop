import { IsObject, IsString, Length } from 'class-validator';

export class SalvarIntegracaoDto {
  @IsString()
  @Length(1, 40)
  plataforma!: string;

  @IsObject()
  credenciais!: Record<string, unknown>;
}
