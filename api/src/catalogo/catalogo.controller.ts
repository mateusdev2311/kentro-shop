import { Controller, Get, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { MAX_VITRINE_INICIAL } from '../config-loja/config-loja.service';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { Produto } from '../contratos/modelo';
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

  /** Os produtos escolhidos para a vitrine inicial, de uma vez (a tela do admin precisa dos nomes). Inexistente fica de fora. */
  @Get('produtos-por-id')
  async produtosPorId(@Req() req: RequisicaoDaLoja, @Query('ids') ids?: string): Promise<Produto[]> {
    const lista = (ids ?? '').split(',').map((id) => id.trim().slice(0, 100)).filter(Boolean).slice(0, MAX_VITRINE_INICIAL);
    if (!lista.length) return [];
    const mapa = await this.catalogo.obterVarios(req.loja.id, lista);
    return lista.map((id) => mapa.get(id) ?? null).filter((p): p is Produto => !!p);
  }

  @Get('produtos/:id')
  produto(@Req() req: RequisicaoDaLoja, @Param('id') id: string) {
    return this.catalogo.obterProduto(req.loja.id, id.trim().slice(0, 100));
  }
}
