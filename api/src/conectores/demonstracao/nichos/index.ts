import { Produto } from '../../../contratos/modelo';
import { BannerDemo, svgDoBanner, svgDoProduto, Visual } from '../imagens';
import { farmacia } from './farmacia';
import { mercado } from './mercado';
import { petshop } from './petshop';
import { revestimentos } from './revestimentos';
import { NichoDemo, ProdutoDemo } from './tipos';

export type { NichoDemo, ProdutoDemo } from './tipos';

/** Na ordem em que aparecem para o atendente e no admin. */
export const NICHOS: NichoDemo[] = [revestimentos, farmacia, petshop, mercado];
export const NICHO_PADRAO = revestimentos.id;
export const IDS_NICHOS = NICHOS.map((n) => n.id);

const POR_ID = new Map(NICHOS.map((n) => [n.id, n]));
/** SKU → produto e nicho. Os SKUs não se repetem entre nichos (prefixos próprios). */
const POR_SKU = new Map<string, { produto: ProdutoDemo; nicho: NichoDemo }>();
for (const nicho of NICHOS) for (const p of nicho.produtos) POR_SKU.set(p.sku, { produto: p, nicho });

/** Nicho pelo id; desconhecido ou vazio = o padrão. */
export function nichoDe(id: string | undefined | null): NichoDemo {
  return POR_ID.get(String(id ?? '').trim()) ?? revestimentos;
}

export function existeNicho(id: string | undefined | null): boolean {
  return POR_ID.has(String(id ?? '').trim());
}

/** Produto de qualquer nicho pelo id/SKU: o carrinho de um link de outro nicho continua encontrando os itens. */
export function produtoDemo(id: string): ProdutoDemo | undefined {
  return POR_SKU.get(id)?.produto;
}

// ── Imagens ──────────────────────────────────────────────────────────────────

const ARQUIVO = /^([A-Z0-9-]+)(?:~([A-Za-z0-9-]+))?\.svg$/;

/** Caminho da imagem (variacaoId = a amostra de cor da variação). */
export function caminhoDaImagem(sku: string, variacaoId?: string): string {
  return `/demo/imagens/${sku}${variacaoId ? `~${variacaoId}` : ''}.svg`;
}

/** O SVG de "SKU.svg" ou "SKU~VARIACAO.svg"; null se não existir. */
export function svgDaImagem(arquivo: string): string | null {
  const m = ARQUIVO.exec(arquivo);
  const achado = m && POR_SKU.get(m[1]);
  if (!achado) return null;
  let visual: Visual = achado.produto.visual;
  if (m[2]) {
    const variacao = achado.produto.variacoes.find((v) => v.id === m[2]);
    if (!variacao?.cores?.length) return null;
    visual = { ...visual, cor: variacao.cores[0], cor2: variacao.cores[1] ?? visual.cor2 };
  }
  return svgDoProduto(visual, achado.nicho.fundoImagem);
}

/** O SVG do banner "nicho-N.svg" (N a partir de 1); null se não existir. */
export function svgDoBannerDemo(arquivo: string): string | null {
  const m = /^([a-z]+)-(\d)\.svg$/.exec(arquivo);
  const nicho = m && POR_ID.get(m[1]);
  const banner = nicho?.banners[Number(m![2]) - 1];
  if (!banner) return null;
  const dados: BannerDemo = {
    titulo: banner.titulo,
    subtitulo: banner.subtitulo,
    cor: banner.cor,
    cor2: banner.cor2,
    visuais: banner.skus.map((s) => POR_SKU.get(s)?.produto.visual).filter((v): v is Visual => !!v),
  };
  return svgDoBanner(dados);
}

/**
 * O produto como sai do conector: sem o desenho e com o endereço absoluto das imagens. Sem o endereço da API
 * (base vazia), sai sem imagem: o contrato pede URL absoluta.
 */
export function produtoPublico(p: ProdutoDemo, base: string): Produto {
  const { visual: _visual, ...resto } = structuredClone(p);
  if (!base) return resto;
  return {
    ...resto,
    imagens: [base + caminhoDaImagem(p.sku)],
    variacoes: resto.variacoes.map((v) => (v.cores?.length ? { ...v, imagem: base + caminhoDaImagem(p.sku, v.id) } : v)),
  };
}
