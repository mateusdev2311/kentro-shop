import { Categoria, Produto } from '../../../contratos/modelo';
import { Visual } from '../imagens';

/** Produto de exemplo: o produto do contrato mais o desenho da imagem (que não sai para fora). */
export type ProdutoDemo = Produto & { visual: Visual };

export interface BannerNicho {
  titulo: string;
  subtitulo: string;
  cor: string;
  cor2: string;
  /** Produtos desenhados no banner (até 3). */
  skus: string[];
  /** Ao tocar: abre esta categoria. */
  categoriaId?: string;
}

/** Um ramo de loja da demonstração, com a vitrine e a aparência de uma loja fictícia daquele ramo. */
export interface NichoDemo {
  id: string;
  /** Nome do ramo, como aparece para o atendente (ex.: "Farmácia"). */
  nome: string;
  /** Fundo das imagens dos produtos. */
  fundoImagem: string;
  loja: {
    /** Nome fictício da loja, sempre com "(exemplo)" fora do catálogo. */
    nome: string;
    corPrimaria: string;
    corTopo: string;
    tituloDestaque: string;
    boasVindas: string;
    vitrineTitulo: string;
    vitrineProdutos: string[];
  };
  banners: BannerNicho[];
  categorias: Categoria[];
  produtos: ProdutoDemo[];
}
