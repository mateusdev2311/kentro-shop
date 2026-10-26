import { Controller, Get, HttpCode, Param, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { CatalogoKentroService } from '../catalogo-kentro/catalogo-kentro.service';
import { ErroApi } from '../comum/erros';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { FotosService } from './fotos.service';
import { SincronizacaoService } from './sincronizacao.service';

/** Cópia do catálogo lida pela API (ex.: banco de dados do ERP): estado e "Sincronizar agora"; fotos do FTP. */
@Controller('v1/loja/catalogo-sincronizado')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
export class SincronizacaoController {
  constructor(
    private readonly sincronizacao: SincronizacaoService,
    private readonly copia: CatalogoKentroService,
    private readonly fotos: FotosService,
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

  @Get('fotos')
  @Papel('admin')
  estadoFotos(@Req() req: RequisicaoDaLoja) {
    return this.fotos.estado(req.loja.id);
  }

  /** Começa em segundo plano: a primeira leitura de um FTP grande leva minutos. A tela acompanha pelo estado. */
  @Post('fotos/sincronizar')
  @HttpCode(202)
  @Papel('admin')
  sincronizarFotos(@Req() req: RequisicaoDaLoja) {
    return this.fotos.iniciar(req.loja.id);
  }

  @Get('fotos/sem-foto')
  @Papel('admin')
  semFoto(@Req() req: RequisicaoDaLoja) {
    return this.fotos.semFoto(req.loja.id);
  }
}

/**
 * Fotos dos produtos para o catálogo do cliente. A URL leva o hash do conteúdo, então pode ficar em cache
 * para sempre. Limite maior que o das outras rotas públicas: uma página do catálogo pede dezenas de fotos.
 */
@Controller('v1/publico/fotos')
@UseGuards(ThrottlerGuard)
@Throttle({ publico: { limit: 1200, ttl: 60_000 } })
@SkipThrottle({ registro: true })
export class FotosPublicoController {
  constructor(private readonly fotos: FotosService) {}

  @Get(':arquivo')
  async foto(@Param('arquivo') arquivo: string, @Res() res: Response) {
    const foto = await this.fotos.foto(arquivo);
    if (!foto) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Foto não encontrada.');
    res.setHeader('Content-Type', foto.tipo);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(foto.imagem);
  }
}
