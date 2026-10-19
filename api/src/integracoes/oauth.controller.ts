import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { Response } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { ErroConector } from '../conectores/nucleo/erros';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { RegistroConectores } from '../conectores/nucleo/registro';
import { ChaveLojaGuard, Papel, RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { assinarEstado, lerEstado } from './estado-oauth';
import { IntegracoesService } from './integracoes.service';

class IniciarOAuthDto {
  @IsString()
  @Length(1, 40)
  plataforma!: string;
}

/** A tela de admin pede o link de autorização da plataforma (ex.: Nuvemshop). */
@Controller('v1/loja/integracao/oauth')
@UseGuards(ChaveLojaGuard)
@UseFilters(FiltroErrosConector)
export class OAuthIniciarController {
  constructor(
    private readonly registro: RegistroConectores,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  @Post('iniciar')
  @HttpCode(200)
  @Papel('admin')
  iniciar(@Req() req: RequisicaoDaLoja, @Body() dto: IniciarOAuthDto) {
    const conector = this.registro.obter(dto.plataforma);
    if (!conector.capacidades.oauth || !conector.urlDeAutorizacao) {
      throw new ErroApi(400, 'SEM_OAUTH', `A ${conector.nome} não usa autorização por link.`);
    }
    const estado = assinarEstado({ lojaId: req.loja.id, plataforma: conector.id }, this.config.chaveMestra);
    return { url: conector.urlDeAutorizacao(estado) };
  }
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Página que o lojista vê no navegador depois de autorizar (ou recusar) na plataforma. */
export function paginaDeRetorno(ok: boolean, titulo: string, texto: string): string {
  const cor = ok ? '#0f7b52' : '#b3261e';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kentro Shop</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#f5f2ec;color:#23211e;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:440px;padding:32px 28px;border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 32px -16px rgba(0,0,0,.25);text-align:center}
.selo{width:56px;height:56px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;background:${cor}1a;color:${cor};font-size:28px;font-weight:700}
h1{margin:0 0 8px;font-size:21px}p{margin:0;color:#6e675e}</style></head>
<body><main><div class="selo">${ok ? '✓' : '!'}</div><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></main></body></html>`;
}

/** Retorno do OAuth (URL cadastrada no app da plataforma). Público: quem prova a loja é o "state" assinado. */
@Controller('v1/oauth/retorno')
@UseGuards(ThrottlerGuard)
@Throttle({ publico: { limit: 30, ttl: 60_000 } })
@SkipThrottle({ registro: true })
export class OAuthRetornoController {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly registro: RegistroConectores,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  @Get(':plataforma')
  async retorno(@Param('plataforma') plataforma: string, @Query() consulta: Record<string, string>, @Res() res: Response): Promise<void> {
    const responder = (status: number, ok: boolean, titulo: string, texto: string) => {
      res.status(status).setHeader('Cache-Control', 'no-store').type('html').send(paginaDeRetorno(ok, titulo, texto));
    };
    const conector = this.registro.listar().find((c) => c.id === plataforma && c.capacidades.oauth && c.concluirAutorizacao);
    if (!conector) return responder(404, false, 'Endereço inválido', 'Este endereço de retorno não é de uma plataforma conectada ao Kentro Shop.');

    const estado = lerEstado(consulta.state, conector.id, this.config.chaveMestra);
    if (!estado) {
      // Sem "state" = instalação começada pela própria plataforma (loja de aplicativos), não pelo Kentro Shop.
      return responder(
        400,
        false,
        'Comece pelo Kentro Shop',
        `Para conectar a ${conector.nome}, abra a Kentro, vá em Kentro Shop > Integração, escolha ${conector.nome} e clique em "Conectar". O link vale por 30 minutos.`,
      );
    }
    if (consulta.error || !consulta.code) {
      return responder(400, false, 'Autorização não concluída', `A ${conector.nome} não autorizou o acesso. Volte à Kentro e clique em "Conectar" de novo.`);
    }

    try {
      const { ctx } = this.integracoes.contextoDeAutorizacao(estado.lojaId, conector.id);
      const credenciais = await conector.concluirAutorizacao!(ctx, consulta);
      await this.integracoes.salvarAutorizacao(estado.lojaId, conector.id, credenciais);
    } catch (e) {
      if (!(e instanceof ErroConector)) throw e;
      return responder(502, false, 'Não foi possível conectar', e.message);
    }
    // Já deixa a integração testada (e a loja ativa): a tela de admin só precisa perceber.
    const teste = await this.integracoes.testar(estado.lojaId).catch(() => null);
    const nome = teste?.ok && teste.nomeLoja ? ` "${teste.nomeLoja}"` : '';
    return responder(200, true, `${conector.nome} conectada`, `A loja${nome} está ligada ao Kentro Shop. Pode fechar esta página e voltar para a Kentro.`);
  }
}
