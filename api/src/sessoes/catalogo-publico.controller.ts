import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { CarrinhoService } from './carrinho.service';
import { FinalizarDto, FreteDto, SalvarCarrinhoDto } from './dto';
import { SessoesService } from './sessoes.service';
import { RequisicaoDoCliente, TokenSessaoGuard } from './token-sessao.guard';

/** Rotas do catálogo do cliente. Autenticação = token do link. */
@Controller('v1/catalogo/:token')
@UseGuards(ThrottlerGuard, TokenSessaoGuard)
@Throttle({ publico: { limit: 120, ttl: 60_000 } })
@SkipThrottle({ registro: true })
@UseFilters(FiltroErrosConector)
export class CatalogoPublicoController {
  constructor(
    private readonly sessoes: SessoesService,
    private readonly carrinho: CarrinhoService,
    private readonly catalogo: CatalogoService,
    private readonly configLoja: ConfigLojaService,
  ) {}

  @Get('abrir')
  async abrir(@Param('token') token: string, @Req() req: RequisicaoDoCliente) {
    const [sessao, config] = await Promise.all([this.sessoes.abrir(token), this.configLoja.obter(req.sessao.lojaId)]);
    return {
      sessao,
      tema: config.tema,
      entrega: config.entrega,
      retirada: { habilitada: config.retirada.habilitada, lojas: config.retirada.habilitada ? config.lojasRetirada : [] },
      frete: config.frete,
    };
  }

  @Get('categorias')
  async categorias(@Req() req: RequisicaoDoCliente) {
    const [categorias, config] = await Promise.all([this.catalogo.listarCategorias(req.sessao.lojaId), this.configLoja.obter(req.sessao.lojaId)]);
    const ocultas = new Set(config.categoriasOcultas);
    return categorias.filter((c) => !ocultas.has(c.id));
  }

  @Get('produtos')
  async produtos(@Req() req: RequisicaoDoCliente, @Query('busca') busca?: string, @Query('categoria') categoria?: string, @Query('pagina') pagina?: string) {
    const lojaId = req.sessao.lojaId;
    const [lista, config] = await Promise.all([
      this.catalogo.listarProdutos(lojaId, {
        busca: busca?.trim().slice(0, 100) || undefined,
        categoriaId: categoria?.trim().slice(0, 50) || undefined,
        pagina: Math.max(1, Math.min(Number.parseInt(pagina ?? '1', 10) || 1, 500)),
      }),
      this.configLoja.obter(lojaId),
    ]);
    const ocultas = new Set(config.categoriasOcultas);
    if (!ocultas.size) return lista;
    // Produto que só está em categorias ocultas também fica de fora.
    return { ...lista, itens: lista.itens.filter((p) => !p.categoriaIds.length || p.categoriaIds.some((c) => !ocultas.has(c))) };
  }

  @Get('produtos/:id')
  produto(@Req() req: RequisicaoDoCliente, @Param('id') id: string) {
    return this.catalogo.obterProduto(req.sessao.lojaId, id.trim().slice(0, 100));
  }

  @Put('carrinho')
  salvarCarrinho(@Param('token') token: string, @Body() dto: SalvarCarrinhoDto) {
    return this.carrinho.definir(token, dto.itens);
  }

  @Post('frete')
  @HttpCode(200)
  frete(@Param('token') token: string, @Body() dto: FreteDto) {
    return this.carrinho.cotarFrete(token, dto.cep);
  }

  @Post('finalizar')
  @HttpCode(200)
  finalizar(@Param('token') token: string, @Body() dto: FinalizarDto) {
    return this.carrinho.finalizar(token, dto);
  }
}
