import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { nomeDoAtendente } from '../sessoes/sessoes.controller';
import { EnviarCarrosselDto, SalvarWhatsappMetaDto } from './dto';
import { WhatsappMetaService } from './whatsapp-meta.service';

/**
 * Atrás do proxy da Kentro o corpo de um erro pode não chegar, e aqui o motivo é o que importa ("token vencido",
 * "produto sem foto"). Por isso a recusa volta com status 200 e { ok: false, mensagem }.
 */
async function resposta<T extends object>(fazer: () => Promise<T>): Promise<T | { ok: false; codigo: string; mensagem: string }> {
  try {
    return await fazer();
  } catch (e) {
    if (e instanceof ErroApi && e.getStatus() < 500) return { ok: false, codigo: e.codigo, mensagem: e.mensagem };
    throw e;
  }
}

/** Aba WhatsApp das Configurações: conta oficial da Meta e templates do carrossel. */
@Controller('v1/loja/whatsapp-meta')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
@Papel('admin')
export class WhatsappMetaController {
  constructor(private readonly whatsapp: WhatsappMetaService) {}

  @Get()
  ler(@Req() req: RequisicaoDaLoja) {
    return this.whatsapp.situacao(req.loja.id);
  }

  @Put()
  salvar(@Req() req: RequisicaoDaLoja, @Body() dto: SalvarWhatsappMetaDto) {
    return resposta(() => this.whatsapp.salvar(req.loja.id, dto));
  }

  @Delete()
  async remover(@Req() req: RequisicaoDaLoja) {
    await this.whatsapp.remover(req.loja.id);
    return { ok: true };
  }

  @Get('templates')
  templates(@Req() req: RequisicaoDaLoja) {
    return resposta(async () => ({ templates: await this.whatsapp.templates(req.loja.id) }));
  }

  @Post('templates')
  @HttpCode(200)
  criarTemplates(@Req() req: RequisicaoDaLoja) {
    return resposta(async () => ({ templates: await this.whatsapp.criarTemplates(req.loja.id) }));
  }
}

/** Painel do atendente: envia o carrossel dos produtos escolhidos. */
@Controller('v1/sessoes/carrossel')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
@Papel('atendimento')
export class CarrosselController {
  constructor(private readonly whatsapp: WhatsappMetaService) {}

  @Get('disponivel')
  async disponivel(@Req() req: RequisicaoDaLoja) {
    return { disponivel: await this.whatsapp.disponivel(req.loja.id) };
  }

  @Post()
  @HttpCode(200)
  enviar(@Req() req: RequisicaoDaLoja, @Body() dto: EnviarCarrosselDto) {
    return resposta(() => this.whatsapp.enviar(req.loja.id, { ...dto, chatId: dto.chatId.trim(), atendente: nomeDoAtendente(req), autor: 'atendente' }));
  }
}
