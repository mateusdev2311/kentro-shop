import { Categoria, Pagina, Produto } from '../../contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../nucleo/conector';
import { CredencialInvalida } from '../nucleo/erros';
import { NICHO_PADRAO, NICHOS, nichoDe, produtoDemo, produtoPublico } from './nichos';

// Conector com catálogos de exemplo (produtos fictícios), um por ramo de loja: revestimentos, farmácia, pet shop
// e supermercado. Serve para testar e apresentar o fluxo inteiro (link, catálogo, carrinho, painel) sem
// credenciais de e-commerce. Traz selo, m² por caixa e compre junto como `regras` de exemplo; as regras gravadas
// pela loja têm prioridade.
//
// O ramo vem de `credenciais.nicho`: o padrão da loja (campo da integração) ou o do link, quando o atendente gera
// o link de um ramo específico (a API troca o valor só naquela leitura). Produto pelo id é procurado em todos os
// ramos, para o carrinho de um link continuar válido mesmo que o padrão da loja mude.

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function exigirCodigo(ctx: CtxConector): void {
  if ((ctx.credenciais.codigo ?? '').trim().toLowerCase() !== 'demo') throw new CredencialInvalida();
}

const nichoDoCtx = (ctx: CtxConector) => nichoDe(ctx.credenciais.nicho);
const base = (ctx: CtxConector) => ctx.urlPublica ?? '';

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
    {
      chave: 'nicho',
      rotulo: 'Ramo padrão',
      tipo: 'select',
      obrigatorio: false,
      ajuda: 'Os produtos de exemplo que o catálogo mostra. O atendente pode gerar o link de outro ramo pelo painel.',
      opcoes: NICHOS.map((n) => ({ valor: n.id, rotulo: n.nome })),
    },
  ],

  async testarConexao(ctx) {
    exigirCodigo(ctx);
    return { ok: true, nomeLoja: `${nichoDoCtx(ctx).loja.nome} (exemplo)` };
  },

  async listarCategorias(ctx): Promise<Categoria[]> {
    exigirCodigo(ctx);
    return structuredClone(nichoDoCtx(ctx).categorias);
  },

  async listarProdutos(ctx, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
    exigirCodigo(ctx);
    const palavras = semAcento(filtro.busca ?? '').split(/\s+/).filter(Boolean);
    const filtrados = nichoDoCtx(ctx).produtos.filter((p) => {
      if (filtro.categoriaId && !p.categoriaIds.includes(filtro.categoriaId)) return false;
      const texto = semAcento([p.nome, p.sku, p.descricaoCurta ?? '', ...p.variacoes.map((v) => v.nome)].join(' '));
      return palavras.every((palavra) => texto.includes(palavra));
    });
    const inicio = (filtro.pagina - 1) * filtro.porPagina;
    return {
      itens: filtrados.slice(inicio, inicio + filtro.porPagina).map((p) => produtoPublico(p, base(ctx))),
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
      total: filtrados.length,
      temMais: inicio + filtro.porPagina < filtrados.length,
    };
  },

  async obterProduto(ctx, id): Promise<Produto | null> {
    exigirCodigo(ctx);
    const produto = produtoDemo(id);
    return produto ? produtoPublico(produto, base(ctx)) : null;
  },

  async relacionados(ctx, id): Promise<Produto[]> {
    exigirCodigo(ctx);
    const skus = produtoDemo(id)?.regras?.compreJunto ?? [];
    return skus
      .map(produtoDemo)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => produtoPublico(p, base(ctx)));
  },
};

export { NICHO_PADRAO };
