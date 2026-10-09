import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from './chave-loja.guard';
import { RegistrarLojaDto } from './dto';
import { LojasService } from './lojas.service';
import { RegistroThrottlerGuard } from './registro-throttler.guard';

@Controller('v1')
export class LojasController {
  constructor(private readonly lojas: LojasService) {}

  @Post('lojas/registrar')
  @UseGuards(RegistroThrottlerGuard)
  @Throttle({ registro: { limit: 5, ttl: 3_600_000 } })
  registrar(@Body() dto: RegistrarLojaDto) {
    return this.lojas.registrar(dto.nome);
  }

  @Get('loja')
  @UseGuards(ChaveLojaGuard)
  @Papel('atendimento')
  dados(@Req() req: RequisicaoDaLoja) {
    const { id, nome, status, plano } = req.loja;
    return { id, nome, status, plano, papel: req.papel };
  }

  @Post('loja/chave-admin/rotacionar')
  @HttpCode(200)
  @UseGuards(ChaveLojaGuard)
  @Papel('admin')
  async rotacionarAdmin(@Req() req: RequisicaoDaLoja) {
    return { chave: await this.lojas.rotacionar(req.loja.id, 'admin') };
  }

  @Post('loja/chave-atendimento/rotacionar')
  @HttpCode(200)
  @UseGuards(ChaveLojaGuard)
  @Papel('admin')
  async rotacionarAtendimento(@Req() req: RequisicaoDaLoja) {
    return { chave: await this.lojas.rotacionar(req.loja.id, 'atendimento') };
  }

  @Post('loja/token-mcp/rotacionar')
  @HttpCode(200)
  @UseGuards(ChaveLojaGuard)
  @Papel('admin')
  async rotacionarTokenMcp(@Req() req: RequisicaoDaLoja) {
    return { chave: await this.lojas.rotacionar(req.loja.id, 'mcp') };
  }
}
