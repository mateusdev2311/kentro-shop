import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { RelatoriosService } from './relatorios.service';

export class PeriodoDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use o formato AAAA-MM-DD.' })
  de?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use o formato AAAA-MM-DD.' })
  ate?: string;
}

/** Aba Relatórios do admin: vendas do período (dias de Brasília). */
@Controller('v1/loja')
@UseGuards(ChaveLojaGuard)
@Papel('admin')
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get('relatorios')
  gerar(@Req() req: RequisicaoDaLoja, @Query() periodo: PeriodoDto) {
    return this.relatorios.gerar(req.loja.id, periodo.de, periodo.ate);
  }
}
