import { Inject, Injectable } from '@nestjs/common';
import { CatalogoKentroService } from '../catalogo-kentro/catalogo-kentro.service';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cifrar, decifrar } from '../comum/cripto';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { criarClienteHttp } from '../conectores/nucleo/cliente-http';
import { Conector, CtxConector } from '../conectores/nucleo/conector';
import { enderecoPublicoHttps, verificarDestino } from '../conectores/nucleo/destino';
import { ErroConector, SemIntegracao } from '../conectores/nucleo/erros';
import { RegistroConectores } from '../conectores/nucleo/registro';

/** O Prisma tipa Bytes como Uint8Array<ArrayBuffer>; o Buffer do Node precisa ser copiado. */
const paraBytes = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

function hostDe(url: string | undefined): string {
  try {
    return url ? new URL(url).host.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Valor que a leitura devolve no lugar de um segredo. Reenviá-lo mantém o valor gravado. */
export const MASCARA = '••••';

export interface IntegracaoLida {
  plataforma: string;
  status: 'pendente' | 'ok' | 'erro';
  ultimoTesteEm: Date | null;
  ultimoErro: string | null;
  credenciais: Record<string, string>;
}

@Injectable()
export class IntegracoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: RegistroConectores,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    private readonly catalogoKentro: CatalogoKentroService,
  ) {}

  async salvar(lojaId: string, plataforma: string, recebidas: Record<string, unknown>): Promise<void> {
    const conector = this.registro.obter(plataforma);
    const declaradas = new Map(conector.camposDeCredencial.map((c) => [c.chave, c]));
    const desconhecidas = Object.keys(recebidas).filter((k) => !declaradas.has(k));
    if (desconhecidas.length) throw new ErroApi(400, 'ENTRADA_INVALIDA', `Campo desconhecido: ${desconhecidas.join(', ')}.`);

    const novos: Record<string, string> = {};
    for (const campo of conector.camposDeCredencial) {
      const bruto = recebidas[campo.chave];
      if (bruto !== undefined && typeof bruto !== 'string') {
        throw new ErroApi(400, 'ENTRADA_INVALIDA', `O campo ${campo.rotulo} precisa ser texto.`);
      }
      novos[campo.chave] = (bruto ?? '').trim();
      // A API chama este endereço a partir do servidor: só https público (proteção contra SSRF).
      if (campo.tipo === 'url' && novos[campo.chave] && !enderecoPublicoHttps(novos[campo.chave])) {
        throw new ErroApi(400, 'ENTRADA_INVALIDA', `O campo ${campo.rotulo} precisa começar com https:// e apontar para um endereço público.`);
      }
    }

    const anteriores = await this.credenciaisGravadas(lojaId, plataforma);
    const camposUrl = conector.camposDeCredencial.filter((c) => c.tipo === 'url');
    const destino = (credenciais: Record<string, string> | null | undefined) => {
      if (!credenciais || !conector.destino) return '';
      try {
        return conector.destino(credenciais);
      } catch {
        return (Object.values(credenciais).join('|') || '').toLowerCase(); // inválido: qualquer mudança conta
      }
    };
    const hostMudou =
      camposUrl.some((c) => hostDe(novos[c.chave]) !== hostDe(anteriores?.[c.chave])) || (!!anteriores && destino(novos) !== destino(anteriores));
    const mascarados = conector.camposDeCredencial.filter((c) => c.tipo === 'segredo' && novos[c.chave] === MASCARA);
    // Reaproveitar o segredo gravado com outro endereço o enviaria para um servidor diferente.
    if (hostMudou && mascarados.length) {
      throw new ErroApi(400, 'ENTRADA_INVALIDA', `Ao trocar o endereço, digite de novo: ${mascarados.map((c) => c.rotulo).join(', ')}.`);
    }

    const credenciais: Record<string, string> = {};
    for (const campo of conector.camposDeCredencial) {
      let valor = novos[campo.chave];
      if (campo.tipo === 'segredo' && valor === MASCARA) valor = anteriores?.[campo.chave] ?? '';
      if (campo.obrigatorio && !valor) throw new ErroApi(400, 'ENTRADA_INVALIDA', `Preencha o campo ${campo.rotulo}.`);
      if (valor) credenciais[campo.chave] = valor;
    }

    const { cifrado, iv } = cifrar(JSON.stringify(credenciais), this.config.chaveMestra);
    const dados = { plataforma, credenciaisCifradas: paraBytes(cifrado), iv: paraBytes(iv), status: 'pendente' as const, ultimoErro: null };
    await this.prisma.integracao.upsert({ where: { lojaId }, create: { lojaId, ...dados }, update: dados });
  }

  async ler(lojaId: string): Promise<IntegracaoLida> {
    const linha = await this.prisma.integracao.findUnique({ where: { lojaId } });
    if (!linha) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Esta loja ainda não configurou a integração.');
    const conector = this.registro.obter(linha.plataforma);
    const credenciais = this.decifrarCredenciais(linha.credenciaisCifradas, linha.iv);
    const mascaradas: Record<string, string> = {};
    for (const campo of conector.camposDeCredencial) {
      const valor = credenciais[campo.chave];
      if (valor !== undefined) mascaradas[campo.chave] = campo.tipo === 'segredo' ? MASCARA : valor;
    }
    return {
      plataforma: linha.plataforma,
      status: linha.status,
      ultimoTesteEm: linha.ultimoTesteEm,
      ultimoErro: linha.ultimoErro,
      credenciais: mascaradas,
    };
  }

  async testar(lojaId: string): Promise<{ ok: true; nomeLoja?: string } | { ok: false; mensagem: string }> {
    const { conector, ctx } = await this.contexto(lojaId);
    let resultado: { ok: true; nomeLoja?: string } | { ok: false; mensagem: string };
    try {
      resultado = await conector.testarConexao(ctx);
    } catch (e) {
      if (!(e instanceof ErroConector)) throw e;
      resultado = { ok: false, mensagem: e.message };
    }
    await this.prisma.integracao.update({
      where: { lojaId },
      data: { status: resultado.ok ? 'ok' : 'erro', ultimoTesteEm: new Date(), ultimoErro: resultado.ok ? null : resultado.mensagem },
    });
    if (resultado.ok) {
      await this.prisma.loja.updateMany({ where: { id: lojaId, status: 'pendente_integracao' }, data: { status: 'ativa' } });
    }
    return resultado;
  }

  /** Conector e contexto da loja, com as credenciais decifradas só para esta chamada. */
  async contexto(lojaId: string): Promise<{ conector: Conector; ctx: CtxConector }> {
    const linha = await this.prisma.integracao.findUnique({ where: { lojaId } });
    if (!linha) throw new SemIntegracao();
    const conector = this.registro.obter(linha.plataforma);
    const ctx: CtxConector = {
      lojaId,
      credenciais: this.decifrarCredenciais(linha.credenciaisCifradas, linha.iv),
      http: criarClienteHttp({
        lojaId,
        plataforma: conector.id,
        ritmo: conector.ritmo,
        verificarDestino: (url) => verificarDestino(url),
        registrar: async (c) => {
          await this.prisma.chamadaConector.create({ data: c });
        },
      }),
      salvarCredenciais: async (novas) => {
        const { cifrado, iv } = cifrar(JSON.stringify({ ...ctx.credenciais, ...novas }), this.config.chaveMestra);
        await this.prisma.integracao.update({ where: { lojaId }, data: { credenciaisCifradas: paraBytes(cifrado), iv: paraBytes(iv) } });
      },
      // O catálogo da Kentro é uma cópia enviada pela extensão (não há leitura ao vivo sem token).
      ...(conector.id === 'kentro' ? { catalogoLocal: this.catalogoKentro.leitor(lojaId) } : {}),
    };
    return { conector, ctx };
  }

  private async credenciaisGravadas(lojaId: string, plataforma: string): Promise<Record<string, string> | null> {
    const linha = await this.prisma.integracao.findUnique({ where: { lojaId } });
    if (!linha || linha.plataforma !== plataforma) return null;
    return this.decifrarCredenciais(linha.credenciaisCifradas, linha.iv);
  }

  private decifrarCredenciais(cifrado: Uint8Array, iv: Uint8Array): Record<string, string> {
    return JSON.parse(decifrar(Buffer.from(cifrado), Buffer.from(iv), this.config.chaveMestra));
  }
}
