import { IsOptional, IsString, Length } from 'class-validator';

export class RegistrarLojaDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  nome?: string;
}
