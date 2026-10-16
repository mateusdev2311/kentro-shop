import { Body, Controller, Delete, Get, HttpCode, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { RegraDto } from './dto';
import { RegrasService } from './regras.service';

function validarSku(sku: string): string {
  const limpo = sku.trim();
  if (!limpo || limpo.length > 100) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'SKU inválido.');
  return limpo;
}

@Controller('v1/loja/regras')
@UseGuards(ChaveLojaGuard)
@Papel('admin')
export class RegrasController {
  constructor(private readonly regras: RegrasService) {}

  @Get()
  listar(@Req() req: RequisicaoDaLoja) {
    return this.regras.listar(req.loja.id);
  }

  @Get(':sku')
  obter(@Req() req: RequisicaoDaLoja, @Param('sku') sku: string) {
    return this.regras.obter(req.loja.id, validarSku(sku));
  }

  @Put(':sku')
  salvar(@Req() req: RequisicaoDaLoja, @Param('sku') sku: string, @Body() dto: RegraDto) {
    return this.regras.salvar(req.loja.id, validarSku(sku), dto);
  }

  @Delete(':sku')
  @HttpCode(204)
  async apagar(@Req() req: RequisicaoDaLoja, @Param('sku') sku: string): Promise<void> {
    await this.regras.apagar(req.loja.id, validarSku(sku));
  }
}
