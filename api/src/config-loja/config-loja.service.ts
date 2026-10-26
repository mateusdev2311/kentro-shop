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

/** Combinações de letras do catálogo (o catálogo carrega as fontes de cada uma). */
export const FONTES = ['classica', 'moderna', 'elegante', 'arredondada', 'forte', 'simples'] as const;
export type Fonte = (typeof FONTES)[number];
export const CANTOS = ['arredondados', 'suaves', 'retos'] as const;
export type Cantos = (typeof CANTOS)[number];
/** Proporção da foto nos cartões: quadrada (1:1) ou em pé (3:4, boa para roupas). */
export const IMAGENS_PRODUTO = ['quadrada', 'retrato'] as const;
export type ImagemProduto = (typeof IMAGENS_PRODUTO)[number];

export interface BannerPublico {
  id: string;
  url: string;
  titulo?: string;
  /** Ao tocar: abre esta categoria ou esta busca. */
  categoriaId?: string;
  busca?: string;
}

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
  /** Título da faixa de boas-vindas (vazio = o padrão do catálogo). */
  tituloDestaque?: string;
  fonte: Fonte;
  cantos: Cantos;
  imagemProduto: ImagemProduto;
  /** Sugestões "Compre também" no fim da vitrine de um link. */
  compreTambem: boolean;
  /** Carrossel no alto da vitrine, na ordem definida pelo admin. */
  banners: BannerPublico[];
  /** Tempo de cada banner no carrossel. */
  bannerSegundos: number;
}

export const MAX_BANNERS = 6;
export const MAX_BANNER_BYTES = 400 * 1024;
const SEGUNDOS_PADRAO = 5;

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
  /** Filas da Kentro que usam este catálogo (ex.: as da unidade). Vazio = todas. */
  filasAtendimento: number[];
}

/** O que o admin pode mudar (tudo opcional: só o que vier é gravado; o tema é mesclado). */
export interface MudancaConfig {
  tema?: Partial<Omit<Tema, 'logoUrl' | 'banners'>>;
  entrega?: { habilitada: boolean };
  retirada?: { habilitada: boolean };
  lojasRetirada?: { id?: string; nome: string; endereco: string; horario?: string; orientacoes?: string }[];
  frete?: { regra: RegraFrete['regra']; valor?: number; minimo?: number; prazo?: string };
  expiracaoLinkDias?: number;
  mostrarPrecos?: boolean;
  categoriasOcultas?: string[];
  filasAtendimento?: number[];
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
const umDe = <T extends string>(opcoes: readonly T[], valor: unknown, padrao: T): T => (opcoes.includes(valor as T) ? (valor as T) : padrao);

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

/** Para onde o banner leva ao ser tocado: uma categoria OU uma busca (a categoria vence). Vazio = só imagem. */
export interface AcaoBanner {
  titulo?: string;
  categoriaId?: string;
  busca?: string;
}

export interface NovoBanner extends AcaoBanner {
  tipo: string;
  base64: string;
}

function acaoDoBanner(dados: AcaoBanner): { titulo: string | null; categoriaId: string | null; busca: string | null } {
  const categoriaId = dados.categoriaId?.trim() || null;
  return {
    titulo: dados.titulo?.trim() || null,
    categoriaId,
    busca: categoriaId ? null : dados.busca?.trim() || null,
  };
}

/** Configuração da loja já com os padrões aplicados; o admin edita pela tela de Configurações. */
@Injectable()
export class ConfigLojaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  async obter(lojaId: string): Promise<ConfigEfetiva> {
    const [loja, gravada, banners] = await Promise.all([
      this.prisma.loja.findUnique({ where: { id: lojaId }, select: { nome: true } }),
      // O logo e os banners (bytes) não são lidos aqui: só o hash, para montar a URL.
      this.prisma.configLoja.findUnique({ where: { lojaId }, omit: { logo: true } }),
      this.prisma.bannerLoja.findMany({
        where: { lojaId },
        orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
        select: { id: true, hash: true, titulo: true, categoriaId: true, busca: true },
      }),
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
        ...(tema.tituloDestaque ? { tituloDestaque: String(tema.tituloDestaque) } : {}),
        fonte: umDe(FONTES, tema.fonte, 'classica'),
        cantos: umDe(CANTOS, tema.cantos, 'arredondados'),
        imagemProduto: umDe(IMAGENS_PRODUTO, tema.imagemProduto, 'quadrada'),
        compreTambem: tema.compreTambem !== false,
        banners: banners.map((b) => ({
          id: b.id,
          url: `${this.config.urlPublica}/v1/publico/lojas/${lojaId}/banners/${b.id}?v=${b.hash}`,
          ...(b.titulo ? { titulo: b.titulo } : {}),
          ...(b.categoriaId ? { categoriaId: b.categoriaId } : {}),
          ...(b.busca ? { busca: b.busca } : {}),
        })),
        bannerSegundos: typeof tema.bannerSegundos === 'number' ? tema.bannerSegundos : SEGUNDOS_PADRAO,
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
      filasAtendimento: gravada?.filasAtendimento ?? [],
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
      ...(mudanca.filasAtendimento ? { filasAtendimento: [...new Set(mudanca.filasAtendimento)].sort((a, b) => a - b) } : {}),
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

  // ── Banners do carrossel ──────────────────────────────

  async adicionarBanner(lojaId: string, dados: NovoBanner): Promise<BannerPublico[]> {
    if ((await this.prisma.bannerLoja.count({ where: { lojaId } })) >= MAX_BANNERS) {
      throw invalido(`O carrossel aceita até ${MAX_BANNERS} banners. Remova um para adicionar outro.`);
    }
    const bytes = Buffer.from(dados.base64, 'base64');
    if (bytes.length > MAX_BANNER_BYTES) throw invalido('Cada banner pode ter até 400 KB. Exporte em JPG ou WebP, com até 1600 px de largura.');
    const real = tipoReal(bytes);
    if (!real || real !== dados.tipo) throw invalido('O arquivo não é uma imagem PNG, JPG ou WebP válida.');
    const ultima = await this.prisma.bannerLoja.aggregate({ where: { lojaId }, _max: { ordem: true } });
    await this.prisma.bannerLoja.create({
      data: {
        lojaId,
        ordem: (ultima._max.ordem ?? -1) + 1,
        imagem: new Uint8Array(bytes),
        tipo: real,
        hash: createHash('sha256').update(bytes).digest('hex').slice(0, 12),
        ...acaoDoBanner(dados),
      },
    });
    return (await this.obter(lojaId)).tema.banners;
  }

  async editarBanner(lojaId: string, id: string, dados: AcaoBanner): Promise<BannerPublico[]> {
    const { count } = await this.prisma.bannerLoja.updateMany({ where: { id, lojaId }, data: acaoDoBanner(dados) });
    if (!count) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Banner não encontrado.');
    return (await this.obter(lojaId)).tema.banners;
  }

  async removerBanner(lojaId: string, id: string): Promise<BannerPublico[]> {
    await this.prisma.bannerLoja.deleteMany({ where: { id, lojaId } });
    return (await this.obter(lojaId)).tema.banners;
  }

  /** Nova ordem: a lista precisa ter exatamente os banners da loja. */
  async ordenarBanners(lojaId: string, ids: string[]): Promise<BannerPublico[]> {
    const atuais = await this.prisma.bannerLoja.findMany({ where: { lojaId }, select: { id: true } });
    const conjunto = new Set(ids);
    if (conjunto.size !== ids.length || ids.length !== atuais.length || atuais.some((b) => !conjunto.has(b.id))) {
      throw invalido('A nova ordem precisa listar todos os banners, uma vez cada.');
    }
    await this.prisma.$transaction(ids.map((id, ordem) => this.prisma.bannerLoja.update({ where: { id }, data: { ordem } })));
    return (await this.obter(lojaId)).tema.banners;
  }

  async banner(lojaId: string, id: string): Promise<{ bytes: Buffer; tipo: string } | null> {
    const b = await this.prisma.bannerLoja.findFirst({ where: { id, lojaId }, select: { imagem: true, tipo: true } });
    return b ? { bytes: Buffer.from(b.imagem), tipo: b.tipo } : null;
  }

  async logo(lojaId: string): Promise<{ bytes: Buffer; tipo: string } | null> {
    const linha = await this.prisma.configLoja.findUnique({ where: { lojaId }, select: { logo: true, logoTipo: true } });
    return linha?.logo && linha.logoTipo ? { bytes: Buffer.from(linha.logo), tipo: linha.logoTipo } : null;
  }
}
