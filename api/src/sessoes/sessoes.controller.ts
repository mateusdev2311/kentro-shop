import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ErroApi } from '../comum/erros';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { CriarSessaoDto } from './dto';
import { SessoesService } from './sessoes.service';

/** Nome do atendente para a atividade (só auditoria; vem do navegador, codificado). Inválido → vazio. */
function nomeDoAtendente(req: RequisicaoDaLoja): string {
  const bruto = req.headers['x-kentro-usuario-nome'];
  if (typeof bruto !== 'string' || !bruto) return '';
  try {
    return decodeURIComponent(bruto).replace(/\p{Cc}/gu, ' ').trim().slice(0, 80);
  } catch {
    return '';
  }
}

/** Rotas do atendimento (painel da extensão e, na 1.4, a IA). */
@Controller('v1/sessoes')
@UseGuards(ChaveLojaGuard)
@Papel('atendimento')
export class SessoesController {
  constructor(private readonly sessoes: SessoesService) {}

  @Post()
  async criar(@Req() req: RequisicaoDaLoja, @Body() dto: CriarSessaoDto, @Res({ passthrough: true }) res: Response) {
    const antes = await this.sessoes.porChat(req.loja.id, dto.chatId.trim());
    const sessao = await this.sessoes.criarOuReaproveitar(req.loja.id, { ...dto, chatId: dto.chatId.trim() }, nomeDoAtendente(req));
    res.status(antes && antes.id === sessao.id ? 200 : 201);
    return sessao;
  }

  @Get('chat/:chatId')
  async porChat(@Req() req: RequisicaoDaLoja, @Param('chatId') chatId: string) {
    const sessao = await this.sessoes.porChat(req.loja.id, chatId.trim().slice(0, 64));
    if (!sessao) throw new ErroApi(404, 'SEM_SESSAO', 'Nenhum link de catálogo foi gerado neste atendimento.');
    return sessao;
  }
}
