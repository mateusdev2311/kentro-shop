import { Categoria, Pagina, Produto } from '../../contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../nucleo/conector';
import { CredencialInvalida } from '../nucleo/erros';
import * as dados from './dados.json';

// Conector com o catálogo de exemplo da demo Shopping dos Pisos (produtos fictícios).
// Serve para testar o fluxo inteiro (link, catálogo, carrinho, painel) sem credenciais de e-commerce.
// Traz selo, m² por caixa e compre junto como `regras` de exemplo; as regras gravadas pela loja têm prioridade.

const CATALOGO = dados as unknown as { categorias: Categoria[]; produtos: Produto[] };

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function exigirCodigo(ctx: CtxConector): void {
  if ((ctx.credenciais.codigo ?? '').trim().toLowerCase() !== 'demo') throw new CredencialInvalida();
}

function porSku(sku: string): Produto | undefined {
  return CATALOGO.produtos.find((p) => p.sku === sku);
}

export const conectorDemonstracao: Conector = {
  id: 'demonstracao',
  nome: 'Demonstração (dados de exemplo)',
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
    historicoCliente: false,
  },
  camposDeCredencial: [
    { chave: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, ajuda: 'Digite demo para usar os produtos de exemplo.' },
  ],

  async testarConexao(ctx) {
    exigirCodigo(ctx);
    return { ok: true, nomeLoja: 'Shopping dos Pisos (exemplo)' };
  },

  async listarCategorias(ctx): Promise<Categoria[]> {
    exigirCodigo(ctx);
    return structuredClone(CATALOGO.categorias);
  },

  async listarProdutos(ctx, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
    exigirCodigo(ctx);
    const palavras = semAcento(filtro.busca ?? '').split(/\s+/).filter(Boolean);
    const filtrados = CATALOGO.produtos.filter((p) => {
      if (filtro.categoriaId && !p.categoriaIds.includes(filtro.categoriaId)) return false;
      const texto = semAcento([p.nome, p.sku, p.descricaoCurta ?? '', ...p.variacoes.map((v) => v.nome)].join(' '));
      return palavras.every((palavra) => texto.includes(palavra));
    });
    const inicio = (filtro.pagina - 1) * filtro.porPagina;
    return {
      itens: structuredClone(filtrados.slice(inicio, inicio + filtro.porPagina)),
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
      total: filtrados.length,
      temMais: inicio + filtro.porPagina < filtrados.length,
    };
  },

  async obterProduto(ctx, id): Promise<Produto | null> {
    exigirCodigo(ctx);
    const produto = porSku(id);
    return produto ? structuredClone(produto) : null;
  },

  async relacionados(ctx, id): Promise<Produto[]> {
    exigirCodigo(ctx);
    const skus = porSku(id)?.regras?.compreJunto ?? [];
    return skus.map(porSku).filter((p): p is Produto => !!p).map((p) => structuredClone(p));
  },
};
