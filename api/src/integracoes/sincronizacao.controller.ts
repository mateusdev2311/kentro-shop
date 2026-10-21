import { Controller, Get, HttpCode, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { CatalogoKentroService } from '../catalogo-kentro/catalogo-kentro.service';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { SincronizacaoService } from './sincronizacao.service';

/** Cópia do catálogo lida pela API (ex.: banco de dados do ERP): estado e "Sincronizar agora". */
@Controller('v1/loja/catalogo-sincronizado')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
export class SincronizacaoController {
  constructor(
    private readonly sincronizacao: SincronizacaoService,
    private readonly copia: CatalogoKentroService,
  ) {}

  @Get()
  @Papel('atendimento')
  estado(@Req() req: RequisicaoDaLoja) {
    return this.copia.estado(req.loja.id);
  }

  @Post('sincronizar')
  @HttpCode(200)
  @Papel('admin')
  sincronizar(@Req() req: RequisicaoDaLoja) {
    return this.sincronizacao.sincronizar(req.loja.id);
  }
}
