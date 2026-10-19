import { Injectable } from '@nestjs/common';
import { Categoria, Pagina, Produto } from '../contratos/modelo';
import { FiltroProdutos } from '../conectores/nucleo/conector';
import { NaoEncontrado } from '../conectores/nucleo/erros';
import { CacheCatalogo } from '../integracoes/cache-catalogo';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { RegraPublica, RegrasService } from '../regras/regras.service';

export const POR_PAGINA = 24;

/** As regras que vêm do conector são a base; as gravadas pela loja têm prioridade, campo a campo. */
function aplicar(produto: Produto, regra: RegraPublica | undefined, compreJunto?: string[]): Produto {
  if (!regra && !compreJunto) return produto;
  const base = produto.regras;
  const selo = regra?.selo || base?.selo;
  const m2PorUnidade = regra?.m2PorUnidade || base?.m2PorUnidade;
  const rendimentoM2 = regra?.rendimentoM2 || base?.rendimentoM2;
  return {
    ...produto,
    regras: {
      ...(selo ? { selo } : {}),
      ...(m2PorUnidade ? { m2PorUnidade } : {}),
      ...(rendimentoM2 ? { rendimentoM2 } : {}),
      compreJunto: compreJunto ?? (regra?.compreJunto.length ? regra.compreJunto : base?.compreJunto) ?? [],
    },
  };
}

/**
 * Catálogo = conector + regras da loja por cima (spec 7.4). Os conectores leem a plataforma ao vivo; a exceção é
 * o catálogo da Kentro, lido da cópia que a extensão sincroniza (catalogo-kentro).
 */
@Injectable()
export class CatalogoService {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly regras: RegrasService,
    private readonly cache: CacheCatalogo,
  ) {}

  async listarCategorias(lojaId: string): Promise<Categoria[]> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    return this.cache.obter(lojaId, 'categorias', conector.cacheSegundos, () => conector.listarCategorias(ctx));
  }

  async listarProdutos(lojaId: string, filtro: Omit<FiltroProdutos, 'porPagina'>): Promise<Pagina<Produto>> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    const completo = { ...filtro, porPagina: POR_PAGINA };
    const pagina = await this.cache.obter(lojaId, `lista|${JSON.stringify(completo)}`, conector.cacheSegundos, () => conector.listarProdutos(ctx, completo));
    const regras = await this.regras.porSkus(lojaId, pagina.itens.map((p) => p.sku));
    return {
      ...pagina,
      itens: pagina.itens.filter((p) => !regras.get(p.sku)?.oculto).map((p) => aplicar(p, regras.get(p.sku))),
    };
  }

  /**
   * Vários produtos de uma vez, com as regras da loja (sem "compre junto"): é o que o carrinho precisa.
   * fresco = ignora o cache (finalização do pedido). Inexistente ou oculto pela loja: null.
   */
  async obterVarios(lojaId: string, ids: string[], opcoes: { fresco?: boolean } = {}): Promise<Map<string, Produto | null>> {
    const unicos = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    const segundos = conector.cacheSegundos;
    const brutos = new Map<string, Produto | null>();
    const faltam = opcoes.fresco ? unicos : unicos.filter((id) => !this.cache.existe(lojaId, `produto|${id}`));
    const lerUm = (id: string) =>
      conector.obterProduto(ctx, id).catch((e: unknown) => {
        if (e instanceof NaoEncontrado) return null;
        throw e;
      });
    for (const id of unicos) if (!faltam.includes(id)) brutos.set(id, await this.cache.obter(lojaId, `produto|${id}`, segundos, () => lerUm(id)));

    if (faltam.length && conector.obterProdutos) {
      const achados = await conector.obterProdutos(ctx, faltam);
      for (const id of faltam) {
        const p = achados.get(id) ?? null;
        brutos.set(id, p);
        this.cache.guardar(lojaId, `produto|${id}`, segundos, p);
      }
    } else if (faltam.length) {
      const lidos = await Promise.all(faltam.map(lerUm));
      faltam.forEach((id, i) => {
        brutos.set(id, lidos[i]);
        this.cache.guardar(lojaId, `produto|${id}`, segundos, lidos[i]);
      });
    }

    const encontrados = [...brutos.values()].filter((p): p is Produto => !!p);
    const regras = await this.regras.porSkus(lojaId, encontrados.map((p) => p.sku));
    const resultado = new Map<string, Produto | null>();
    for (const [id, p] of brutos) resultado.set(id, p && !regras.get(p.sku)?.oculto ? aplicar(p, regras.get(p.sku)) : null);
    return resultado;
  }

  async obterProduto(lojaId: string, id: string): Promise<Produto> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    const segundos = conector.cacheSegundos;
    const produto = await this.cache.obter(lojaId, `produto|${id}`, segundos, () => conector.obterProduto(ctx, id));
    const regra = produto ? (await this.regras.porSkus(lojaId, [produto.sku])).get(produto.sku) : undefined;
    if (!produto || regra?.oculto) throw new NaoEncontrado('Produto não encontrado.');
    const nativos =
      conector.capacidades.relacionados && conector.relacionados
        ? await this.cache.obter(lojaId, `relacionados|${id}`, segundos, () => conector.relacionados!(ctx, id))
        : [];
    // A lista manual da loja vem primeiro; os relacionados da plataforma completam, sem repetir.
    const compreJunto = [...new Set([...(regra?.compreJunto ?? []), ...nativos.map((p) => p.sku)])].filter((sku) => sku !== produto.sku);
    return aplicar(produto, regra, compreJunto);
  }
}
