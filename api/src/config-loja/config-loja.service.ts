import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { enderecoPublicoHttps } from '../conectores/nucleo/destino';

export interface LojaRetirada {
  id: string;
  nome: string;
  endereco: string;
  horario: string;
  orientacoes: string;
}

export type RegraFrete =
  | { regra: 'a_combinar'; prazo?: string }
  | { regra: 'fixo'; valor: number; prazo?: string }
  | { regra: 'gratis_acima_de'; valor: number; minimo: number; prazo?: string };

export type Layout = 'grade' | 'lista';

export interface Tema {
  nome: string;
  corPrimaria: string;
  /** Cor da faixa do topo (padrão: grafite). */
  corTopo?: string;
  layout: Layout;
  /** Faixa de boas-vindas no alto da vitrine. */
  destaque: boolean;
  logoUrl?: string;
  boasVindas?: string;
}

export interface ConfigEfetiva {
  tema: Tema;
  entrega: { habilitada: boolean };
  retirada: { habilitada: boolean };
  lojasRetirada: LojaRetirada[];
  frete: RegraFrete;
  expiracaoLinkDias: number;
  modoPedido: 'handoff' | 'criar_pedido';
  categoriasOcultas: string[];
  urlCapturaKentro: string | null;
  /** Padrão da loja; o link pode mudar. */
  mostrarPrecos: boolean;
}

/** O que o admin pode mudar (tudo opcional: só o que vier é gravado; o tema é mesclado). */
export interface MudancaConfig {
  tema?: Partial<Omit<Tema, 'logoUrl'>>;
  entrega?: { habilitada: boolean };
  retirada?: { habilitada: boolean };
  lojasRetirada?: { id?: string; nome: string; endereco: string; horario?: string; orientacoes?: string }[];
  frete?: { regra: RegraFrete['regra']; valor?: number; minimo?: number; prazo?: string };
  expiracaoLinkDias?: number;
  mostrarPrecos?: boolean;
  categoriasOcultas?: string[];
  /** criar_pedido: ao finalizar, o pedido é criado na plataforma (ex.: rascunho com link de pagamento na Nuvemshop). */
  modoPedido?: 'handoff' | 'criar_pedido';
  /** Vazio desliga o aviso de pedido finalizado. */
  urlCapturaKentro?: string;
}

/** Endereço de captura de webhook da Kentro: https público, no caminho das capturas. */
export function capturaKentroValida(url: string): boolean {
  if (!enderecoPublicoHttps(url)) return false;
  return /^\/webhookcapture\/capture\/[A-Za-z0-9_-]{8,}\/?$/.test(new URL(url).pathname);
}

const COR_PADRAO = '#7C3AED';
export const TIPOS_DE_LOGO = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_LOGO_BYTES = 300 * 1024;

type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objeto) : {});

/** Contraste de uma cor com o texto branco (WCAG). Botões e o topo usam texto branco. */
export function contrasteComBranco(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const canal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return 1.05 / (luminancia + 0.05);
}

/** O conteúdo bate com o tipo declarado? (Nunca confiar só no tipo enviado.) */
function tipoReal(bytes: Buffer): (typeof TIPOS_DE_LOGO)[number] | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const invalido = (mensagem: string) => new ErroApi(400, 'ENTRADA_INVALIDA', mensagem);

/** Configuração da loja já com os padrões aplicados; o admin edita pela tela de Configurações. */
@Injectable()
export class ConfigLojaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  async obter(lojaId: string): Promise<ConfigEfetiva> {
    const [loja, gravada] = await Promise.all([
      this.prisma.loja.findUnique({ where: { id: lojaId }, select: { nome: true } }),
      // O logo (bytes) não é lido aqui: só o hash, para montar a URL.
      this.prisma.configLoja.findUnique({ where: { lojaId }, omit: { logo: true } }),
    ]);
    const tema = objeto(gravada?.tema);
    const entrega = objeto(gravada?.entrega);
    const retirada = objeto(gravada?.retirada);
    const frete = objeto(gravada?.frete);
    const logoUrl = gravada?.logoHash ? `${this.config.urlPublica}/v1/publico/lojas/${lojaId}/logo?v=${gravada.logoHash}` : tema.logoUrl ? String(tema.logoUrl) : '';
    return {
      tema: {
        nome: String(tema.nome || loja?.nome || 'Catálogo'),
        corPrimaria: String(tema.corPrimaria || COR_PADRAO),
        ...(tema.corTopo ? { corTopo: String(tema.corTopo) } : {}),
        layout: tema.layout === 'lista' ? 'lista' : 'grade',
        destaque: tema.destaque !== false,
        ...(logoUrl ? { logoUrl } : {}),
        ...(tema.boasVindas ? { boasVindas: String(tema.boasVindas) } : {}),
      },
      entrega: { habilitada: entrega.habilitada !== false },
      retirada: { habilitada: retirada.habilitada === true },
      lojasRetirada: Array.isArray(gravada?.lojasRetirada) ? (gravada!.lojasRetirada as unknown as LojaRetirada[]) : [],
      frete: frete.regra ? (frete as unknown as RegraFrete) : { regra: 'a_combinar' },
      expiracaoLinkDias: gravada?.expiracaoLinkDias ?? 7,
      modoPedido: gravada?.modoPedido === 'criar_pedido' ? 'criar_pedido' : 'handoff',
      categoriasOcultas: gravada?.categoriasOcultas ?? [],
      urlCapturaKentro: gravada?.urlCapturaKentro ?? null,
      mostrarPrecos: gravada?.mostrarPrecos ?? true,
    };
  }

  /** Grava só o que veio, depois de validar o resultado completo (ex.: sempre uma forma de receber). */
  async atualizar(lojaId: string, mudanca: MudancaConfig): Promise<ConfigEfetiva> {
    const atual = await this.obter(lojaId);
    const gravada = await this.prisma.configLoja.findUnique({ where: { lojaId }, select: { tema: true } });

    const tema = { ...objeto(gravada?.tema) };
    if (mudanca.tema) {
      for (const [chave, valor] of Object.entries(mudanca.tema)) {
        if (valor === undefined) continue;
        if (typeof valor === 'string' && !valor.trim() && chave !== 'corPrimaria') delete tema[chave];
        else tema[chave] = typeof valor === 'string' ? valor.trim() : valor;
      }
      if (mudanca.tema.corPrimaria && contrasteComBranco(mudanca.tema.corPrimaria) < 3) {
        throw invalido('A cor principal é clara demais: o texto branco dos botões ficaria ilegível. Escolha um tom mais escuro.');
      }
      if (mudanca.tema.corTopo && contrasteComBranco(mudanca.tema.corTopo) < 3) {
        throw invalido('A cor do topo é clara demais: o nome da loja e a busca ficariam ilegíveis. Escolha um tom mais escuro.');
      }
    }

    let frete: RegraFrete | undefined;
    if (mudanca.frete) {
      const { regra, valor, minimo } = mudanca.frete;
      const prazo = mudanca.frete.prazo?.trim() ? { prazo: mudanca.frete.prazo.trim() } : {};
      if (regra === 'fixo') {
        if (valor === undefined) throw invalido('Informe o valor do frete.');
        frete = { regra, valor, ...prazo };
      } else if (regra === 'gratis_acima_de') {
        if (valor === undefined || minimo === undefined) throw invalido('Informe o valor do frete e o pedido mínimo para frete grátis.');
        frete = { regra, valor, minimo, ...prazo };
      } else {
        frete = { regra: 'a_combinar', ...prazo };
      }
    }

    let urlCapturaKentro: string | null | undefined;
    if (mudanca.urlCapturaKentro !== undefined) {
      urlCapturaKentro = mudanca.urlCapturaKentro.trim() || null;
      if (urlCapturaKentro && !capturaKentroValida(urlCapturaKentro)) {
        throw invalido('Cole o endereço da captura de webhook da Kentro (https://…/webhookcapture/capture/…).');
      }
    }

    const lojasRetirada = mudanca.lojasRetirada?.map((l) => ({
      id: l.id?.trim() || `loja-${randomBytes(4).toString('hex')}`,
      nome: l.nome.trim(),
      endereco: l.endereco.trim(),
      horario: (l.horario ?? '').trim(),
      orientacoes: (l.orientacoes ?? '').trim(),
    }));

    const entrega = mudanca.entrega ?? atual.entrega;
    const retirada = mudanca.retirada ?? atual.retirada;
    if (!entrega.habilitada && !retirada.habilitada) throw invalido('Deixe ao menos uma forma de receber ligada: entrega ou retirada.');
    if (retirada.habilitada && !(lojasRetirada ?? atual.lojasRetirada).length) throw invalido('Cadastre ao menos uma loja para retirada.');

    const dados: Prisma.ConfigLojaUncheckedUpdateInput = {
      ...(mudanca.tema ? { tema: tema as Prisma.InputJsonValue } : {}),
      ...(mudanca.entrega ? { entrega } : {}),
      ...(mudanca.retirada ? { retirada } : {}),
      ...(lojasRetirada ? { lojasRetirada: lojasRetirada as unknown as Prisma.InputJsonValue } : {}),
      ...(frete ? { frete: frete as unknown as Prisma.InputJsonValue } : {}),
      ...(mudanca.expiracaoLinkDias !== undefined ? { expiracaoLinkDias: mudanca.expiracaoLinkDias } : {}),
      ...(mudanca.mostrarPrecos !== undefined ? { mostrarPrecos: mudanca.mostrarPrecos } : {}),
      ...(mudanca.modoPedido ? { modoPedido: mudanca.modoPedido } : {}),
      ...(urlCapturaKentro !== undefined ? { urlCapturaKentro } : {}),
      ...(mudanca.categoriasOcultas ? { categoriasOcultas: [...new Set(mudanca.categoriasOcultas.map((c) => c.trim()).filter(Boolean))] } : {}),
    };
    await this.prisma.configLoja.upsert({
      where: { lojaId },
      create: { ...(dados as Prisma.ConfigLojaUncheckedCreateInput), lojaId },
      update: dados,
    });
    return this.obter(lojaId);
  }

  async salvarLogo(lojaId: string, tipo: string, base64: string): Promise<string> {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_LOGO_BYTES) throw invalido('O logo pode ter até 300 KB.');
    const real = tipoReal(bytes);
    if (!real || real !== tipo) throw invalido('O arquivo não é uma imagem PNG, JPG ou WebP válida.');
    const logoHash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const dados = { logo: bytes, logoTipo: real, logoHash };
    await this.prisma.configLoja.upsert({ where: { lojaId }, create: { lojaId, ...dados }, update: dados });
    return (await this.obter(lojaId)).tema.logoUrl!;
  }

  async removerLogo(lojaId: string): Promise<void> {
    await this.prisma.configLoja.updateMany({ where: { lojaId }, data: { logo: null, logoTipo: null, logoHash: null } });
  }

  async logo(lojaId: string): Promise<{ bytes: Buffer; tipo: string } | null> {
    const linha = await this.prisma.configLoja.findUnique({ where: { lojaId }, select: { logo: true, logoTipo: true } });
    return linha?.logo && linha.logoTipo ? { bytes: Buffer.from(linha.logo), tipo: linha.logoTipo } : null;
  }
}
