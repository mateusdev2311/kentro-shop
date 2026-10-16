import { Injectable } from '@nestjs/common';
import { Categoria, Pagina, Produto } from '../contratos/modelo';
import { FiltroProdutos } from '../conectores/nucleo/conector';
import { NaoEncontrado } from '../conectores/nucleo/erros';
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

/** Catálogo = conector ao vivo + regras da loja por cima (spec 7.4). Nada do catálogo é gravado. */
@Injectable()
export class CatalogoService {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly regras: RegrasService,
  ) {}

  async listarCategorias(lojaId: string): Promise<Categoria[]> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    return conector.listarCategorias(ctx);
  }

  async listarProdutos(lojaId: string, filtro: Omit<FiltroProdutos, 'porPagina'>): Promise<Pagina<Produto>> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    const pagina = await conector.listarProdutos(ctx, { ...filtro, porPagina: POR_PAGINA });
    const regras = await this.regras.porSkus(lojaId, pagina.itens.map((p) => p.sku));
    return {
      ...pagina,
      itens: pagina.itens.filter((p) => !regras.get(p.sku)?.oculto).map((p) => aplicar(p, regras.get(p.sku))),
    };
  }

  async obterProduto(lojaId: string, id: string): Promise<Produto> {
    const { conector, ctx } = await this.integracoes.contexto(lojaId);
    const produto = await conector.obterProduto(ctx, id);
    const regra = produto ? (await this.regras.porSkus(lojaId, [produto.sku])).get(produto.sku) : undefined;
    if (!produto || regra?.oculto) throw new NaoEncontrado('Produto não encontrado.');
    const nativos = conector.capacidades.relacionados && conector.relacionados ? await conector.relacionados(ctx, id) : [];
    // A lista manual da loja vem primeiro; os relacionados da plataforma completam, sem repetir.
    const compreJunto = [...new Set([...(regra?.compreJunto ?? []), ...nativos.map((p) => p.sku)])].filter((sku) => sku !== produto.sku);
    return aplicar(produto, regra, compreJunto);
  }
}
