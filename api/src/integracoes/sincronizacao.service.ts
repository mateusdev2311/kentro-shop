import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CatalogoKentroService, EstadoCatalogoKentro } from '../catalogo-kentro/catalogo-kentro.service';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { traduzirErroConector } from '../conectores/nucleo/erros';
import { RegistroConectores } from '../conectores/nucleo/registro';
import { FotosService } from './fotos.service';
import { IntegracoesService } from './integracoes.service';

export const OPCOES_SINCRONIZACAO = Symbol('OPCOES_SINCRONIZACAO');

export interface OpcoesSincronizacao {
  /** Liga a rodada periódica (desligada nos testes). */
  automatica: boolean;
}

/** De quanto em quanto tempo a rodada procura cópias vencidas. Cada conector diz a validade da sua. */
const VERIFICAR_A_CADA_MS = 60_000;

/**
 * Cópia do catálogo lida pela própria API, para conectores com `sincronizacao` (ex.: banco de dados do ERP).
 * O admin sincroniza pela tela; a rodada automática renova as cópias vencidas, uma loja por vez.
 */
@Injectable()
export class SincronizacaoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Sincronização');
  private relogio: NodeJS.Timeout | null = null;
  private rodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: RegistroConectores,
    private readonly integracoes: IntegracoesService,
    private readonly copia: CatalogoKentroService,
    private readonly fotos: FotosService,
    @Inject(OPCOES_SINCRONIZACAO) private readonly opcoes: OpcoesSincronizacao,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.opcoes.automatica || !this.sincronizaveis().length) return;
    this.relogio = setInterval(() => void this.rodada(), VERIFICAR_A_CADA_MS);
    this.relogio.unref();
  }

  onApplicationShutdown(): void {
    if (this.relogio) clearInterval(this.relogio);
  }

  /** Lê a fonte e troca a cópia. Falhou: a cópia anterior continua e o motivo fica no estado. */
  async sincronizar(lojaId: string, { automatica = false } = {}): Promise<EstadoCatalogoKentro> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    if (!conector.sincronizacao || !conector.lerCatalogoCompleto) {
      throw new ErroApi(409, 'SEM_SINCRONIZACAO', `O catálogo da ${conector.nome} é lido ao vivo: não há o que sincronizar.`);
    }
    const lote = await this.copia.travar(lojaId);
    try {
      const catalogo = await conector.lerCatalogoCompleto(ctx);
      // A fonte não tem as fotos: vão as já copiadas do FTP (a leitura do FTP tem o seu próprio ritmo).
      if (conector.fotosFtp) await this.fotos.aplicarNoCatalogo(ctx.credenciais, catalogo);
      await this.copia.trocar(lojaId, lote, catalogo, { automatica });
    } catch (e) {
      const erro = traduzirErroConector(e);
      if (erro.codigo === 'ERRO_INTERNO') this.logger.error(`Loja ${lojaId}: ${e instanceof Error ? e.stack : String(e)}`);
      await this.copia.falhou(lojaId, lote, erro.mensagem);
      throw erro;
    }
    return this.copia.estado(lojaId);
  }

  /**
   * Renova as cópias vencidas e, depois, as fotos vencidas. Depois de uma falha, espera o mesmo intervalo
   * antes de tentar de novo.
   */
  async rodada(agora = Date.now()): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const conectores = new Map(this.sincronizaveis().map((c) => [c.id, c]));
      const lojas = await this.prisma.integracao.findMany({
        where: { plataforma: { in: [...conectores.keys()] }, loja: { status: { not: 'bloqueada' } } },
        select: {
          lojaId: true,
          plataforma: true,
          loja: { select: { catalogoKentro: { select: { sincronizadoEm: true, ultimoErroEm: true, fotosSincronizadasEm: true, fotosErroEm: true } } } },
        },
      });
      const vencida = (minutos: number, ...datas: (Date | null | undefined)[]) => agora - Math.max(0, ...datas.map((d) => d?.getTime() ?? 0)) >= minutos * 60_000;
      for (const { lojaId, plataforma, loja } of lojas) {
        const conector = conectores.get(plataforma)!;
        const c = loja.catalogoKentro;
        if (vencida(conector.sincronizacao!.minutos, c?.sincronizadoEm, c?.ultimoErroEm)) {
          try {
            await this.sincronizar(lojaId, { automatica: true });
          } catch (e) {
            this.logger.warn(`Loja ${lojaId}: ${traduzirErroConector(e).mensagem}`);
          }
        }
        if (conector.fotosFtp && vencida(conector.fotosFtp.minutos, c?.fotosSincronizadasEm, c?.fotosErroEm)) {
          try {
            await this.fotos.sincronizar(lojaId);
          } catch (e) {
            const erro = traduzirErroConector(e);
            if (erro.codigo !== 'SEM_FTP') this.logger.warn(`Loja ${lojaId}, fotos: ${erro.mensagem}`);
          }
        }
      }
    } catch (e) {
      this.logger.error(`Rodada de sincronização falhou: ${String(e)}`);
    } finally {
      this.rodando = false;
    }
  }

  private sincronizaveis() {
    return this.registro.listar().filter((c) => c.sincronizacao && c.lerCatalogoCompleto);
  }
}
