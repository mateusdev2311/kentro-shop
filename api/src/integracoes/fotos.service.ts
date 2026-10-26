import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { CatalogoSincronizado } from '../conectores/nucleo/conector';
import { ErroConector, PlataformaIndisponivel, traduzirErroConector } from '../conectores/nucleo/erros';
import { ABRIR_FTP, AbrirFtp, ArquivoFtp, CredenciaisFtp, lerCredenciaisFtp } from '../conectores/nucleo/ftp';
import { IntegracoesService } from './integracoes.service';

/** Foto maior que isto é ignorada (o padrão combinado é 800 x 800, perto de 100 KB). */
export const MAX_FOTO_BYTES = 2 * 1024 * 1024;
/** Fotos por produto (principal + _2, _3...). */
const MAX_ORDEM = 10;
const LINHAS_POR_COMANDO = 500;
/** Proteção de memória da lista de arquivos recusados. */
const MAX_RECUSADOS = 20_000;

const semZeros = (s: string): string => s.replace(/^0+(?=\d)/, '');

/**
 * Nome do arquivo no padrão combinado com a loja: "<EAN>.jpg" ou "cod_<código interno>.jpg", com "_2", "_3"...
 * para as fotos extras. Zeros à esquerda não contam (o ERP pode ter o EAN de 12 dígitos e a foto o de 13).
 */
export function lerNomeFoto(nome: string): { chave: string; ordem: number } | null {
  const m = nome.match(/^(cod_)?(\d{1,18})(?:_(\d{1,2}))?\.(jpe?g|png|webp)$/i);
  if (!m) return null;
  const ordem = m[3] ? Number(m[3]) : 1;
  if (ordem < 1 || ordem > MAX_ORDEM) return null;
  if (m[1]) return { chave: `cod_${semZeros(m[2])}`, ordem };
  return m[2].length >= 6 ? { chave: semZeros(m[2]), ordem } : null;
}

/** As chaves de foto de um produto, na ordem de preferência: o código de barras, depois o código interno. */
export function chavesDoProduto(id: string, codigoBarras: string | null | undefined): string[] {
  const ean = (codigoBarras ?? '').replace(/\D/g, '');
  return [...(ean.length >= 6 ? [semZeros(ean)] : []), `cod_${semZeros(id)}`];
}

/** Tipo pelo conteúdo (não pela extensão): só JPG, PNG e WebP. */
export function tipoDaImagem(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const EXTENSAO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Servidor + porta + pasta: lojas com o mesmo FTP (filiais da mesma rede) compartilham as fotos. */
export function origemFtp(c: CredenciaisFtp): string {
  return createHash('sha256').update(`${c.host}:${c.porta}${c.pasta}`).digest('hex').slice(0, 24);
}

export interface EstadoFotos {
  /** A loja tem o FTP das fotos configurado. */
  configurado: boolean;
  sincronizando: boolean;
  /** Durante a leitura: quantas das fotos a baixar já vieram. */
  progresso: { feitas: number; total: number } | null;
  sincronizadasEm: Date | null;
  erro: string | null;
  erroEm: Date | null;
  /** Produtos da cópia com e sem foto. */
  comFoto: number;
  semFoto: number;
}

/**
 * Fotos dos produtos num FTP da loja (conectores com `fotosFtp`). A API copia as fotos (só as novas ou
 * alteradas, só as de produtos da loja), guarda no banco e as serve em https; a cópia do catálogo leva a URL.
 */
@Injectable()
export class FotosService {
  private readonly logger = new Logger('Fotos');
  /** Leitura em andamento por loja, com o progresso. */
  private readonly andamento = new Map<string, { feitas: number; total: number }>();
  /** Arquivos que não eram imagem (origem|nome|tamanho|data): só são tentados de novo se mudarem no FTP. */
  private readonly recusados = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    @Inject(ABRIR_FTP) private readonly abrirFtp: AbrirFtp,
  ) {}

  urlDa(foto: { hash: string; tipo: string }): string {
    return `${this.config.urlPublica}/v1/publico/fotos/${foto.hash}.${EXTENSAO[foto.tipo] ?? 'jpg'}`;
  }

  /** A foto pela URL pública (hash + extensão). */
  async foto(arquivo: string): Promise<{ imagem: Buffer; tipo: string } | null> {
    const m = arquivo.match(/^([a-f0-9]{40})\.(jpg|png|webp)$/);
    if (!m) return null;
    const foto = await this.prisma.fotoProduto.findFirst({ where: { hash: m[1] }, select: { imagem: true, tipo: true } });
    return foto ? { imagem: Buffer.from(foto.imagem), tipo: foto.tipo } : null;
  }

  /** URLs das fotos por chave, em ordem. */
  private async urlsPorChave(origem: string): Promise<Map<string, string[]>> {
    const fotos = await this.prisma.fotoProduto.findMany({ where: { origem }, select: { chave: true, ordem: true, hash: true, tipo: true }, orderBy: [{ chave: 'asc' }, { ordem: 'asc' }] });
    const mapa = new Map<string, string[]>();
    for (const f of fotos) mapa.set(f.chave, [...(mapa.get(f.chave) ?? []), this.urlDa(f)]);
    return mapa;
  }

  private imagensDo(mapa: Map<string, string[]>, id: string, codigoBarras: string | null | undefined): string[] {
    for (const chave of chavesDoProduto(id, codigoBarras)) {
      const urls = mapa.get(chave);
      if (urls?.length) return urls;
    }
    return [];
  }

  /** Na sincronização do catálogo: os produtos que chegam da fonte já levam as fotos baixadas. */
  async aplicarNoCatalogo(credenciais: Record<string, string>, catalogo: CatalogoSincronizado): Promise<void> {
    const ftp = lerCredenciaisFtp(credenciais);
    if (!ftp || typeof ftp === 'string') return;
    const mapa = await this.urlsPorChave(origemFtp(ftp));
    if (!mapa.size) return;
    for (const item of catalogo.produtos) {
      const imagens = this.imagensDo(mapa, item.produto.id, item.codigoBarras);
      if (imagens.length) item.produto.imagens = imagens;
    }
  }

  /** Depois de baixar: atualiza as fotos na cópia que já está no ar (sem esperar a próxima leitura do catálogo). */
  private async aplicarNaCopia(lojaId: string, origem: string): Promise<void> {
    const mapa = await this.urlsPorChave(origem);
    const linhas = await this.prisma.produtoKentro.findMany({ where: { lojaId }, select: { id: true, codigoBarras: true } });
    for (let i = 0; i < linhas.length; i += LINHAS_POR_COMANDO) {
      const parte = linhas.slice(i, i + LINHAS_POR_COMANDO);
      const ids = parte.map((l) => l.id);
      const imagens = parte.map((l) => JSON.stringify(this.imagensDo(mapa, l.id, l.codigoBarras)));
      await this.prisma.$executeRaw`
        UPDATE produtos_kentro AS p
           SET dados = jsonb_set(p.dados, '{imagens}', v.imagens)
          FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${imagens}::text[])::jsonb AS imagens) AS v
         WHERE p.loja_id = ${lojaId}::uuid AND p.id = v.id AND (p.dados -> 'imagens') IS DISTINCT FROM v.imagens`;
    }
  }

  async estado(lojaId: string): Promise<EstadoFotos> {
    const [integracao, copia, contagem] = await Promise.all([
      this.integracoes.contexto(lojaId).then(
        ({ conector, ctx }) => {
          const ftp = lerCredenciaisFtp(ctx.credenciais);
          return !!conector.fotosFtp && !!ftp && typeof ftp !== 'string';
        },
        () => false,
      ),
      this.prisma.catalogoKentro.findUnique({ where: { lojaId }, select: { fotosSincronizadasEm: true, fotosErro: true, fotosErroEm: true } }),
      this.prisma.$queryRaw<{ com: bigint; total: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(dados -> 'imagens', '[]'::jsonb)) > 0) AS com, COUNT(*) AS total
          FROM produtos_kentro WHERE loja_id = ${lojaId}::uuid`,
    ]);
    const com = Number(contagem[0]?.com ?? 0);
    const progresso = this.andamento.get(lojaId) ?? null;
    return {
      configurado: integracao,
      sincronizando: !!progresso,
      progresso: progresso ? { ...progresso } : null,
      sincronizadasEm: copia?.fotosSincronizadasEm ?? null,
      erro: copia?.fotosErro ?? null,
      erroEm: copia?.fotosErroEm ?? null,
      comFoto: com,
      semFoto: Number(contagem[0]?.total ?? 0) - com,
    };
  }

  /** Produtos da cópia ainda sem foto (para a loja saber o que falta publicar no FTP). */
  async semFoto(lojaId: string, limite = 300): Promise<{ id: string; nome: string; codigoBarras: string | null }[]> {
    return this.prisma.$queryRaw`
      SELECT id, nome, codigo_barras AS "codigoBarras" FROM produtos_kentro
       WHERE loja_id = ${lojaId}::uuid AND jsonb_array_length(COALESCE(dados -> 'imagens', '[]'::jsonb)) = 0
       ORDER BY nome, id LIMIT ${limite}`;
  }

  /** "Buscar fotos agora": começa em segundo plano (a primeira leitura pode levar minutos); a tela acompanha pelo estado. */
  async iniciar(lojaId: string): Promise<EstadoFotos> {
    await this.preparar(lojaId); // erro de configuração aparece na hora
    if (!this.andamento.has(lojaId)) {
      this.sincronizar(lojaId).catch((e) => this.logger.warn(`Loja ${lojaId}: ${traduzirErroConector(e).mensagem}`));
      await new Promise((r) => setImmediate(r)); // a leitura já marcou o andamento
    }
    return this.estado(lojaId);
  }

  private async preparar(lojaId: string): Promise<CredenciaisFtp> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    if (!conector.fotosFtp) throw new ErroApi(409, 'SEM_FOTOS_FTP', `A ${conector.nome} não usa fotos por FTP.`);
    const ftp = lerCredenciaisFtp(ctx.credenciais);
    if (!ftp) throw new ErroApi(409, 'SEM_FTP', 'Configure o FTP das fotos na integração e salve.');
    if (typeof ftp === 'string') throw new ErroApi(400, 'ENTRADA_INVALIDA', ftp);
    return ftp;
  }

  /** Lê o FTP e baixa o que é novo ou mudou. Falha no meio: o que já veio fica, e a próxima leitura continua. */
  async sincronizar(lojaId: string): Promise<EstadoFotos> {
    const ftp = await this.preparar(lojaId);
    if (this.andamento.has(lojaId)) throw new ErroApi(409, 'SINCRONIZANDO', 'As fotos já estão sendo buscadas. Aguarde terminar.');
    const progresso = { feitas: 0, total: 0 };
    this.andamento.set(lojaId, progresso);
    const origem = origemFtp(ftp);
    let baixou = false;
    try {
      const conexao = await this.abrirFtp(ftp);
      try {
        const noFtp = new Map<string, ArquivoFtp & { chave: string; ordem: number }>();
        for (const arquivo of (await conexao.listar()).sort((a, b) => a.nome.localeCompare(b.nome))) {
          const lido = lerNomeFoto(arquivo.nome);
          const k = lido && `${lido.chave}|${lido.ordem}`;
          if (lido && k && !noFtp.has(k)) noFtp.set(k, { ...arquivo, ...lido });
        }

        const produtos = await this.prisma.produtoKentro.findMany({ where: { lojaId }, select: { id: true, codigoBarras: true } });
        const desejadas = new Set(produtos.flatMap((p) => chavesDoProduto(p.id, p.codigoBarras)));
        const gravadas = new Map(
          (await this.prisma.fotoProduto.findMany({ where: { origem }, select: { chave: true, ordem: true, arquivo: true, tamanho: true, modificadoEm: true } })).map(
            (f) => [`${f.chave}|${f.ordem}`, f],
          ),
        );
        const marca = (f: ArquivoFtp) => `${origem}|${f.nome}|${f.tamanho}|${f.modificadoEm}`;
        const baixar = [...noFtp.values()].filter((f) => {
          if (!desejadas.has(f.chave) || f.tamanho > MAX_FOTO_BYTES || f.tamanho <= 0 || this.recusados.has(marca(f))) return false;
          const g = gravadas.get(`${f.chave}|${f.ordem}`);
          return !g || g.arquivo !== f.nome || g.tamanho !== f.tamanho || g.modificadoEm !== f.modificadoEm;
        });
        progresso.total = baixar.length;

        for (const f of baixar) {
          let imagem: Buffer;
          try {
            imagem = await conexao.baixar(f.nome, MAX_FOTO_BYTES);
          } catch (e) {
            // Uma foto ruim não para as outras; servidor fora do ar, sim.
            if (e instanceof PlataformaIndisponivel || !(e instanceof ErroConector)) throw e;
            progresso.feitas += 1;
            continue;
          }
          progresso.feitas += 1;
          const tipo = tipoDaImagem(imagem);
          if (!tipo) {
            if (this.recusados.size >= MAX_RECUSADOS) this.recusados.clear();
            this.recusados.add(marca(f));
            continue;
          }
          const dados = {
            arquivo: f.nome,
            tamanho: f.tamanho,
            modificadoEm: f.modificadoEm,
            hash: createHash('sha256').update(imagem).digest('hex').slice(0, 40),
            tipo,
            imagem: new Uint8Array(imagem),
            baixadaEm: new Date(),
          };
          await this.prisma.fotoProduto.upsert({
            where: { origem_chave_ordem: { origem, chave: f.chave, ordem: f.ordem } },
            create: { origem, chave: f.chave, ordem: f.ordem, ...dados },
            update: dados,
          });
          baixou = true;
        }

        // A foto que saiu do FTP sai da loja também.
        const removidas = [...gravadas.entries()].filter(([k]) => !noFtp.has(k)).map(([, g]) => ({ chave: g.chave, ordem: g.ordem }));
        for (let i = 0; i < removidas.length; i += LINHAS_POR_COMANDO) {
          await this.prisma.fotoProduto.deleteMany({ where: { origem, OR: removidas.slice(i, i + LINHAS_POR_COMANDO) } });
        }
        baixou ||= removidas.length > 0;
      } finally {
        conexao.fechar();
      }
      await this.aplicarNaCopia(lojaId, origem);
      await this.gravarEstado(lojaId, { fotosSincronizadasEm: new Date(), fotosErro: null, fotosErroEm: null });
    } catch (e) {
      const erro = traduzirErroConector(e);
      if (erro.codigo === 'ERRO_INTERNO') this.logger.error(`Loja ${lojaId}: ${e instanceof Error ? e.stack : String(e)}`);
      if (baixou) await this.aplicarNaCopia(lojaId, origem).catch(() => undefined);
      await this.gravarEstado(lojaId, { fotosErro: erro.mensagem.slice(0, 300), fotosErroEm: new Date() });
      throw erro;
    } finally {
      this.andamento.delete(lojaId);
    }
    return this.estado(lojaId);
  }

  private async gravarEstado(lojaId: string, dados: { fotosSincronizadasEm?: Date; fotosErro: string | null; fotosErroEm: Date | null }) {
    await this.prisma.catalogoKentro.upsert({ where: { lojaId }, create: { lojaId, ...dados }, update: dados });
  }
}
