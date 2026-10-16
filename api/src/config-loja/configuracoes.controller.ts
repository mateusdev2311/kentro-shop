import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Put, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { ErroApi } from '../comum/erros';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { ConfigLojaService } from './config-loja.service';
import { AtualizarConfigDto, LogoDto } from './dto';

/** Tela de Configurações (extensão Admin): aparência, entrega, pedidos e catálogo. */
@Controller('v1/loja')
@UseGuards(ChaveLojaGuard)
@Papel('admin')
export class ConfiguracoesController {
  constructor(private readonly configLoja: ConfigLojaService) {}

  @Get('configuracoes')
  ler(@Req() req: RequisicaoDaLoja) {
    return this.configLoja.obter(req.loja.id);
  }

  @Patch('configuracoes')
  atualizar(@Req() req: RequisicaoDaLoja, @Body() dto: AtualizarConfigDto) {
    return this.configLoja.atualizar(req.loja.id, dto);
  }

  @Put('logo')
  async enviarLogo(@Req() req: RequisicaoDaLoja, @Body() dto: LogoDto) {
    return { logoUrl: await this.configLoja.salvarLogo(req.loja.id, dto.tipo, dto.base64) };
  }

  @Delete('logo')
  async removerLogo(@Req() req: RequisicaoDaLoja) {
    await this.configLoja.removerLogo(req.loja.id);
    return { ok: true };
  }
}

/** Logo da loja para o catálogo do cliente. A URL leva o hash (?v=), então pode ficar em cache para sempre. */
@Controller('v1/publico/lojas')
@UseGuards(ThrottlerGuard)
@Throttle({ publico: { limit: 120, ttl: 60_000 } })
@SkipThrottle({ registro: true })
export class LogoPublicoController {
  constructor(private readonly configLoja: ConfigLojaService) {}

  @Get(':lojaId/logo')
  async logo(@Param('lojaId', new ParseUUIDPipe()) lojaId: string, @Res() res: Response) {
    const logo = await this.configLoja.logo(lojaId);
    if (!logo) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Esta loja não tem logo.');
    res.setHeader('Content-Type', logo.tipo);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(logo.bytes);
  }
}
