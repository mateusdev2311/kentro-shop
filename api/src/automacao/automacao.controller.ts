import { Body, Controller, HttpCode, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { ATENDENTE_URA, limparFiltro, SessoesService } from '../sessoes/sessoes.service';
import { ChaveAutomacaoGuard } from './chave-automacao.guard';
import { LinkAutomacaoDto } from './dto';

/** Rotas da URA/automação da Kentro (chave ksu_). Só geram o link: não mexem em carrinho nem em pedido. */
@Controller('v1/automacao')
@UseGuards(ChaveAutomacaoGuard)
@UseFilters(FiltroErrosConector)
export class AutomacaoController {
  constructor(private readonly sessoes: SessoesService) {}

  /**
   * Link do catálogo do atendimento. Sem categoria/busca reaproveita o link aberto do chat (a URA pode chamar de novo
   * sem duplicar). Responde sempre 200 com `url` no topo, que é o que a URA testa e manda ao cliente.
   */
  @Post('link')
  @HttpCode(200)
  async link(@Req() req: RequisicaoDaLoja, @Body() dto: LinkAutomacaoDto) {
    const filtro = limparFiltro({ categoriaId: dto.categoriaId, busca: dto.busca });
    const { sessao, linkNovo } = await this.sessoes.criarOuReaproveitar(
      req.loja.id,
      { chatId: dto.chatId.trim(), nome: dto.nome, telefone: dto.telefone },
      ATENDENTE_URA,
      filtro ? { filtro } : null,
    );
    return { url: sessao.url, novo: linkNovo, expiraEm: sessao.expiraEm, sessaoId: sessao.id };
  }
}
