import { Controller, HttpCode, Inject, Injectable, Logger, OnModuleInit, Post, Req, UseGuards } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { verificarDestino } from '../conectores/nucleo/destino';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { moeda } from './calculo';
import { CarrinhoService } from './carrinho.service';
import { SessoesService } from './sessoes.service';
import { SessaoCompleta } from './tipos';

// Aviso de pedido finalizado para a Kentro (spec 11.3): a API posta numa captura de webhook da instância, e a
// automação dela provoca a assistente de IA no atendimento. Os campos vão no primeiro nível, para virarem
// variáveis da captura sem caminho. Falha no aviso nunca desfaz a finalização.

export interface AvisoKentro {
  evento: 'carrinho_finalizado' | 'teste';
  chatId: string;
  sessaoId: string;
  nome: string;
  telefone: string;
  tipo: 'entrega' | 'retirada' | '';
  total: number;
  totalTexto: string;
  itens: number;
  resumo: string;
  pedidoNumero: string;
  linkPagamento: string;
}

/** Envia o aviso e devolve o status HTTP. Substituível nos testes. */
export type EnvioAviso = (url: string, aviso: AvisoKentro) => Promise<number>;

export const ENVIO_AVISO = Symbol('ENVIO_AVISO');

const ESPERA_MS = 5000;

export const enviarAvisoHttp: EnvioAviso = async (url, aviso) => {
  await verificarDestino(url);
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(aviso),
    redirect: 'manual',
    signal: AbortSignal.timeout(ESPERA_MS),
  });
  return resposta.status;
};

export function avisoDe(sessao: SessaoCompleta): AvisoKentro {
  return {
    evento: 'carrinho_finalizado',
    chatId: '',
    sessaoId: sessao.id,
    nome: sessao.cliente.nome,
    telefone: sessao.cliente.telefone,
    tipo: sessao.checkout?.tipo ?? '',
    total: sessao.totais.total,
    totalTexto: moeda(sessao.totais.total),
    itens: sessao.totais.itens,
    resumo: sessao.resumo,
    pedidoNumero: sessao.pedido?.numero ?? '',
    linkPagamento: sessao.pedido?.url ?? '',
  };
}

@Injectable()
export class AvisoKentroService implements OnModuleInit {
  private readonly logger = new Logger('AvisoKentro');

  constructor(
    private readonly carrinho: CarrinhoService,
    private readonly sessoes: SessoesService,
    private readonly configLoja: ConfigLojaService,
    @Inject(ENVIO_AVISO) private readonly enviar: EnvioAviso,
  ) {}

  onModuleInit(): void {
    this.carrinho.registrarAoFinalizar((sessao, lojaId) => this.aoFinalizar(sessao, lojaId));
  }

  private async aoFinalizar(sessao: SessaoCompleta, lojaId: string): Promise<void> {
    const { urlCapturaKentro } = await this.configLoja.obter(lojaId);
    if (!urlCapturaKentro) return;
    // O chatId é do atendimento, não do cliente: não vem na SessaoCompleta.
    const chatId = (await this.sessoes.chatDaSessao(sessao.id)) ?? '';
    const status = await this.enviar(urlCapturaKentro, { ...avisoDe(sessao), chatId }).catch((e: unknown) => {
      this.logger.warn(`aviso não entregue: ${e instanceof Error ? e.constructor.name : 'erro'}`);
      return 0;
    });
    const texto = status >= 200 && status < 300 ? 'Kentro avisada: a assistente de IA vai confirmar o pedido' : `Aviso à Kentro não entregue (${status ? `HTTP ${status}` : 'sem resposta'})`;
    await this.sessoes.registrar(sessao.id, 'aviso', texto, 'sistema').catch(() => undefined);
  }

  /** Botão "Testar" da aba IA: posta um aviso de teste (sem atendimento) e devolve o status. */
  async testar(lojaId: string): Promise<{ ok: boolean; status: number }> {
    const { urlCapturaKentro } = await this.configLoja.obter(lojaId);
    if (!urlCapturaKentro) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'Salve o endereço da captura de webhook antes de testar.');
    const status = await this.enviar(urlCapturaKentro, {
      evento: 'teste',
      chatId: '0',
      sessaoId: '',
      nome: '',
      telefone: '',
      tipo: '',
      total: 0,
      totalTexto: moeda(0),
      itens: 0,
      resumo: 'Teste do Kentro Shop',
      pedidoNumero: '',
      linkPagamento: '',
    }).catch(() => 0);
    return { ok: status >= 200 && status < 300, status };
  }
}

@Controller('v1/loja/ia')
@UseGuards(ChaveLojaGuard)
@Papel('admin')
export class AvisoKentroController {
  constructor(private readonly aviso: AvisoKentroService) {}

  @Post('testar-evento')
  @HttpCode(200)
  testar(@Req() req: RequisicaoDaLoja) {
    return this.aviso.testar(req.loja.id);
  }
}
