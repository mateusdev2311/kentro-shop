import { Categoria, Pagina, Produto } from '../../src/contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../../src/conectores/nucleo/conector';
import { CredencialInvalida, PlataformaIndisponivel } from '../../src/conectores/nucleo/erros';

// Conector em memória para os testes e2e: não faz HTTP.

export function produtoFalso(sku: string, extra: Partial<Produto> = {}): Produto {
  return {
    id: `id-${sku}`,
    sku,
    nome: `Produto ${sku}`,
    descricao: `Descrição ${sku}`,
    imagens: [`https://img.teste/${sku}.jpg`],
    preco: 10,
    unidade: 'UN',
    estoque: 5,
    disponivel: true,
    categoriaIds: ['1'],
    variacoes: [],
    ...extra,
  };
}

export const PRODUTOS_FALSOS: Produto[] = [
  produtoFalso('A1', { preco: 129.9, precoDe: 149.9 }),
  produtoFalso('B2', { categoriaIds: ['2'] }),
  produtoFalso('C3', {
    variacoes: [
      { id: 'v1', sku: 'C3-AZ', nome: 'Azul', atributos: { Cor: 'Azul' }, preco: 20, estoque: 3, disponivel: true },
      { id: 'v2', sku: 'C3-VD', nome: 'Verde', atributos: { Cor: 'Verde' }, preco: 20, estoque: 0, disponivel: false },
    ],
    atributosVariacao: ['Cor'],
  }),
];

export const CATEGORIAS_FALSAS: Categoria[] = [
  { id: '1', nome: 'Pisos', ordem: 1 },
  { id: '2', nome: 'Argamassas', ordem: 2 },
];

/** Controle do comportamento do conector falso nos testes. */
export const controleFalso = {
  indisponivel: false,
  relacionados: [] as string[],
  /** Preço atual por SKU (simula mudança de preço na loja). */
  precos: {} as Record<string, number>,
  /** SKUs que "sumiram" da loja. */
  removidos: [] as string[],
};

export function reiniciarFalso(): void {
  controleFalso.indisponivel = false;
  controleFalso.relacionados = [];
  controleFalso.precos = {};
  controleFalso.removidos = [];
}

export const conectorFalso: Conector = {
  id: 'falso',
  nome: 'Plataforma Falsa',
  ritmo: { porSegundo: 1000, rajada: 1000 },
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: true,
    estoque: true,
    relacionados: true,
    cotarFrete: false,
    criarPedido: false,
    oauth: false,
  },
  camposDeCredencial: [
    { chave: 'url_api', rotulo: 'Endereço da API', tipo: 'url', obrigatorio: true },
    { chave: 'token', rotulo: 'Token', tipo: 'segredo', obrigatorio: true },
  ],
  async testarConexao(ctx: CtxConector) {
    return ctx.credenciais.token === 'certo' ? { ok: true as const, nomeLoja: 'Loja Falsa' } : { ok: false as const, mensagem: 'Token recusado.' };
  },
  async listarCategorias() {
    if (controleFalso.indisponivel) throw new PlataformaIndisponivel();
    return CATEGORIAS_FALSAS;
  },
  async listarProdutos(ctx: CtxConector, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
    if (controleFalso.indisponivel) throw new PlataformaIndisponivel();
    if (ctx.credenciais.token !== 'certo') throw new CredencialInvalida();
    let itens = PRODUTOS_FALSOS.map((p) => structuredClone(p));
    if (filtro.busca) itens = itens.filter((p) => p.nome.toLowerCase().includes(filtro.busca!.toLowerCase()));
    if (filtro.categoriaId) itens = itens.filter((p) => p.categoriaIds.includes(filtro.categoriaId!));
    const inicio = (filtro.pagina - 1) * filtro.porPagina;
    return {
      itens: itens.slice(inicio, inicio + filtro.porPagina),
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
      total: itens.length,
      temMais: inicio + filtro.porPagina < itens.length,
    };
  },
  async obterProduto(_ctx: CtxConector, id: string) {
    if (controleFalso.indisponivel) throw new PlataformaIndisponivel();
    const p = PRODUTOS_FALSOS.find((x) => x.id === id || x.sku === id);
    if (!p || controleFalso.removidos.includes(p.sku)) return null;
    const copia = structuredClone(p);
    if (controleFalso.precos[p.sku] !== undefined) copia.preco = controleFalso.precos[p.sku];
    return copia;
  },
  async relacionados() {
    return controleFalso.relacionados.map((sku) => produtoFalso(sku));
  },
};
