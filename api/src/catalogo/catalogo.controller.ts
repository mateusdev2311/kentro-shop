import { Controller, Get, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { CatalogoService } from './catalogo.service';

/** Catálogo da loja para as extensões (prévia na aba Integração e painel do atendente). */
@Controller('v1/loja/catalogo')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
@Papel('atendimento')
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get('categorias')
  categorias(@Req() req: RequisicaoDaLoja) {
    return this.catalogo.listarCategorias(req.loja.id);
  }

  @Get('produtos')
  produtos(
    @Req() req: RequisicaoDaLoja,
    @Query('busca') busca?: string,
    @Query('categoria') categoria?: string,
    @Query('pagina') pagina?: string,
  ) {
    const numero = Math.max(1, Math.min(Number.parseInt(pagina ?? '1', 10) || 1, 500));
    return this.catalogo.listarProdutos(req.loja.id, {
      busca: busca?.trim().slice(0, 100) || undefined,
      categoriaId: categoria?.trim().slice(0, 50) || undefined,
      pagina: numero,
    });
  }

  @Get('produtos/:id')
  produto(@Req() req: RequisicaoDaLoja, @Param('id') id: string) {
    return this.catalogo.obterProduto(req.loja.id, id.trim().slice(0, 100));
  }
}
