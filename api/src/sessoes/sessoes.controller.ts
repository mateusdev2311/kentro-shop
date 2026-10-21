import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ErroApi } from '../comum/erros';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { CarrinhoService } from './carrinho.service';
import { ClientesService } from './clientes.service';
import { CriarSessaoDto, SalvarCarrinhoDto } from './dto';
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
@UseFilters(FiltroErrosConector)
@Papel('atendimento')
export class SessoesController {
  constructor(
    private readonly sessoes: SessoesService,
    private readonly carrinho: CarrinhoService,
    private readonly clientes: ClientesService,
  ) {}

  /**
   * Gera (ou reaproveita) o link do atendimento. Com filtro, preços ou carrinho pronto, o link é sempre novo, mas o
   * carrinho continua o mesmo: os itens do carrinho pronto são somados e os links anteriores continuam valendo.
   * A resposta traz `avisos` quando algum item do carrinho pronto não pôde entrar.
   */
  @Post()
  async criar(@Req() req: RequisicaoDaLoja, @Body() dto: CriarSessaoDto, @Res({ passthrough: true }) res: Response) {
    const { filtro, restrito, mostrarPrecos, itens, ...contato } = dto;
    const chatId = dto.chatId.trim();
    const montado = filtro || itens?.length || restrito !== undefined || mostrarPrecos !== undefined ? { filtro, restrito, mostrarPrecos } : null;
    let { sessao, linkNovo } = await this.sessoes.criarOuReaproveitar(req.loja.id, { ...contato, chatId }, nomeDoAtendente(req), montado);
    let avisos: string[] = [];
    if (itens?.length) ({ sessao, avisos } = await this.carrinho.adicionarPeloAtendente(req.loja.id, sessao.id, itens));
    res.status(linkNovo ? 201 : 200);
    return { ...sessao, avisos };
  }

  /** Endereços e pedidos anteriores do contato nesta loja (painel: "pedidos anteriores"). */
  @Get('historico')
  historico(@Req() req: RequisicaoDaLoja, @Query('telefone') telefone?: string) {
    return this.clientes.historico(req.loja.id, { nome: '', telefone: String(telefone ?? '').slice(0, 30) });
  }

  @Get('chat/:chatId')
  async porChat(@Req() req: RequisicaoDaLoja, @Param('chatId') chatId: string) {
    const sessao = await this.sessoes.porChat(req.loja.id, chatId.trim().slice(0, 64));
    if (!sessao) throw new ErroApi(404, 'SEM_SESSAO', 'Nenhum link de catálogo foi gerado neste atendimento.');
    return sessao;
  }

  /** O atendente troca o carrinho de um link ainda aberto. */
  @Put(':id/carrinho')
  carrinhoDoAtendente(@Req() req: RequisicaoDaLoja, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SalvarCarrinhoDto) {
    return this.carrinho.definirPeloAtendente(req.loja.id, id, dto.itens);
  }

  /** O atendente soma itens ao carrinho do link aberto, sem gerar link novo (o cliente não perde o que escolheu). */
  @Post(':id/itens')
  @HttpCode(200)
  adicionarItens(@Req() req: RequisicaoDaLoja, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SalvarCarrinhoDto) {
    return this.carrinho.adicionarPeloAtendente(req.loja.id, id, dto.itens);
  }
}
