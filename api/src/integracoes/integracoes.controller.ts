import { Body, Controller, Get, HttpCode, Post, Put, Req, UseFilters, UseGuards } from '@nestjs/common';
import { RegistroConectores } from '../conectores/nucleo/registro';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { SalvarIntegracaoDto } from './dto';
import { IntegracoesService } from './integracoes.service';

@Controller('v1')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
export class IntegracoesController {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly registro: RegistroConectores,
  ) {}

  @Get('conectores')
  @Papel('atendimento')
  conectores() {
    return this.registro
      .listar()
      .map(({ id, nome, capacidades, camposDeCredencial, sincronizacao, fotosFtp }) => ({
        id,
        nome,
        capacidades,
        camposDeCredencial,
        ...(sincronizacao ? { sincronizacao } : {}),
        ...(fotosFtp ? { fotosFtp } : {}),
      }));
  }

  @Get('loja/integracao')
  @Papel('admin')
  ler(@Req() req: RequisicaoDaLoja) {
    return this.integracoes.ler(req.loja.id);
  }

  @Put('loja/integracao')
  @Papel('admin')
  async salvar(@Req() req: RequisicaoDaLoja, @Body() dto: SalvarIntegracaoDto) {
    await this.integracoes.salvar(req.loja.id, dto.plataforma, dto.credenciais);
    return this.integracoes.ler(req.loja.id);
  }

  @Post('loja/integracao/testar')
  @HttpCode(200)
  @Papel('admin')
  testar(@Req() req: RequisicaoDaLoja) {
    return this.integracoes.testar(req.loja.id);
  }
}
