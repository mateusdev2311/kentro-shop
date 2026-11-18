import { Visual } from '../imagens';
import { ProdutoDemo } from './tipos';

interface OpcaoDemo {
  /** Final do SKU e do id da variação (ex.: "P" → FRD-PCT-P). */
  sufixo: string;
  nome: string;
  preco?: number;
  precoDe?: number;
  estoque?: number;
  cores?: string[];
}

interface DadosProduto {
  sku: string;
  nome: string;
  descricao: string;
  curta: string;
  preco: number;
  de?: number;
  unidade?: string;
  estoque?: number;
  categoria: string;
  selo?: string;
  junto?: string[];
  visual: Visual;
  /** Nome do atributo das opções (ex.: "Tamanho"). */
  atributo?: string;
  opcoes?: OpcaoDemo[];
}

/** Produto de exemplo em uma linha de dados: id = SKU, opções viram variações com o mesmo preço por padrão. */
export function produto(d: DadosProduto): ProdutoDemo {
  const atributo = d.atributo ?? 'Opção';
  const variacoes = (d.opcoes ?? []).map((o) => ({
    id: `${d.sku}-${o.sufixo}`,
    sku: `${d.sku}-${o.sufixo}`,
    nome: o.nome,
    atributos: { [atributo]: o.nome },
    preco: o.preco ?? d.preco,
    ...(o.precoDe ?? d.de ? { precoDe: o.precoDe ?? d.de } : {}),
    estoque: o.estoque ?? 40,
    disponivel: (o.estoque ?? 40) > 0,
    ...(o.cores ? { cores: o.cores } : {}),
  }));
  const estoque = d.estoque ?? 80;
  return {
    id: d.sku,
    sku: d.sku,
    nome: d.nome,
    descricao: d.descricao,
    descricaoCurta: d.curta,
    imagens: [],
    preco: d.preco,
    ...(d.de ? { precoDe: d.de } : {}),
    unidade: d.unidade ?? 'UN',
    estoque,
    disponivel: estoque > 0,
    categoriaIds: [d.categoria],
    variacoes,
    ...(variacoes.length ? { atributosVariacao: [atributo] } : {}),
    regras: {
      compreJunto: d.junto ?? [],
      ...(d.selo ? { selo: d.selo } : {}),
    },
    visual: d.visual,
  };
}
