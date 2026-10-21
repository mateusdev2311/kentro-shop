import { Inject, Injectable } from '@nestjs/common';
import { CatalogoKentroService } from '../catalogo-kentro/catalogo-kentro.service';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cifrar, decifrar } from '../comum/cripto';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ABRIR_BANCO, AbrirBanco } from '../conectores/nucleo/banco';
import { ChamadaRegistrada, criarClienteHttp } from '../conectores/nucleo/cliente-http';
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
  /** Plataforma com OAuth: a loja já autorizou o app. */
  conectada?: boolean;
}

@Injectable()
export class IntegracoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: RegistroConectores,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    private readonly catalogoKentro: CatalogoKentroService,
    @Inject(ABRIR_BANCO) private readonly abrirBanco: AbrirBanco,
  ) {}

  async salvar(lojaId: string, plataforma: string, recebidas: Record<string, unknown>): Promise<void> {
    const conector = this.registro.obter(plataforma);
    // Gravar pelo formulário apagaria o token que a autorização deu.
    if (conector.capacidades.oauth) {
      throw new ErroApi(400, 'USE_CONECTAR', `Para a ${conector.nome}, use o botão "Conectar ${conector.nome}".`);
    }
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
    const invalida = conector.validarCredenciais?.(credenciais);
    if (invalida) throw new ErroApi(400, 'ENTRADA_INVALIDA', invalida);

    await this.gravar(lojaId, conector, credenciais);
  }

  /** Credenciais que vieram da autorização (OAuth), já trocadas pelo conector. */
  async salvarAutorizacao(lojaId: string, plataforma: string, credenciais: Record<string, string>): Promise<void> {
    await this.gravar(lojaId, this.registro.obter(plataforma), credenciais);
  }

  private async gravar(lojaId: string, conector: Conector, credenciais: Record<string, string>): Promise<void> {
    const { cifrado, iv } = cifrar(JSON.stringify(credenciais), this.config.chaveMestra);
    const dados = {
      plataforma: conector.id,
      credenciaisCifradas: paraBytes(cifrado),
      iv: paraBytes(iv),
      status: 'pendente' as const,
      ultimoErro: null,
      idExterno: conector.idExterno?.(credenciais) ?? null,
    };
    const anterior = await this.prisma.integracao.findUnique({ where: { lojaId }, select: { plataforma: true } });
    await this.prisma.integracao.upsert({ where: { lojaId }, create: { lojaId, ...dados }, update: dados });
    if (anterior && anterior.plataforma !== conector.id) await this.catalogoKentro.apagar(lojaId);
  }

  /** A loja cria o pedido na plataforma ao finalizar? (modo "criar pedido" + conector que sabe criar). */
  async criaPedidoNaPlataforma(lojaId: string, modoPedido: string): Promise<boolean> {
    if (modoPedido !== 'criar_pedido') return false;
    const linha = await this.prisma.integracao.findUnique({ where: { lojaId }, select: { plataforma: true } });
    if (!linha) return false;
    const conector = this.registro.listar().find((c) => c.id === linha.plataforma);
    return !!conector?.capacidades.criarPedido && !!conector.criarPedido;
  }

  /** Depois da autorização: o que o conector precisa fazer na plataforma (ex.: registrar webhooks). */
  async aoConectar(lojaId: string): Promise<void> {
    const { conector, ctx } = await this.contexto(lojaId);
    await conector.aoConectar?.(ctx);
  }

  /** Contexto para concluir a autorização: ainda sem credenciais, só o cliente HTTP do conector. */
  contextoDeAutorizacao(lojaId: string, plataforma: string): { conector: Conector; ctx: CtxConector } {
    const conector = this.registro.obter(plataforma);
    return { conector, ctx: this.criarContexto(lojaId, conector, {}) };
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
      ...(conector.capacidades.oauth ? { conectada: Object.keys(credenciais).length > 0 } : {}),
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
    return { conector, ctx: this.criarContexto(lojaId, conector, this.decifrarCredenciais(linha.credenciaisCifradas, linha.iv)) };
  }

  private criarContexto(lojaId: string, conector: Conector, credenciais: Record<string, string>): CtxConector {
    const registrar = async (c: ChamadaRegistrada) => {
      await this.prisma.chamadaConector.create({ data: c });
    };
    const ctx: CtxConector = {
      lojaId,
      credenciais,
      http: criarClienteHttp({
        lojaId,
        plataforma: conector.id,
        ritmo: conector.ritmo,
        verificarDestino: (url) => verificarDestino(url),
        registrar,
      }),
      salvarCredenciais: async (novas) => {
        const { cifrado, iv } = cifrar(JSON.stringify({ ...ctx.credenciais, ...novas }), this.config.chaveMestra);
        await this.prisma.integracao.update({ where: { lojaId }, data: { credenciaisCifradas: paraBytes(cifrado), iv: paraBytes(iv) } });
      },
      // Catálogo da Kentro (enviado pela extensão, não há leitura ao vivo sem token) e o de banco de dados
      // (lento demais ao vivo): o conector lê a cópia.
      ...(conector.id === 'kentro' || conector.sincronizacao ? { catalogoLocal: this.catalogoKentro.leitor(lojaId) } : {}),
      ...(conector.banco
        ? { banco: this.abrirBanco({ lojaId, plataforma: conector.id, motor: conector.banco.motor, bancoPadrao: conector.banco.bancoPadrao, credenciais, registrar }) }
        : {}),
    };
    return ctx;
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
