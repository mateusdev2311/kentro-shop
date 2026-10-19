import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { CatalogoKentroService } from './catalogo-kentro.service';
import { LoteCatalogoKentroDto } from './dto';

/** Sincronização do catálogo da Kentro: a tela de admin e o painel do atendimento enviam os produtos. */
@Controller('v1/loja/catalogo-kentro')
@UseGuards(ChaveLojaGuard)
export class CatalogoKentroController {
  constructor(private readonly catalogo: CatalogoKentroService) {}

  @Get()
  @Papel('atendimento')
  estado(@Req() req: RequisicaoDaLoja) {
    return this.catalogo.estado(req.loja.id);
  }

  @Post('lotes')
  @HttpCode(200)
  @Papel('atendimento')
  receber(@Req() req: RequisicaoDaLoja, @Body() dto: LoteCatalogoKentroDto) {
    return this.catalogo.receberLote(req.loja.id, req.papel, dto);
  }
}
