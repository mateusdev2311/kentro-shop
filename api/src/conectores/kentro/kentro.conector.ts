import { Produto } from '../../contratos/modelo';
import { CatalogoLocal, Conector, CtxConector } from '../nucleo/conector';
import { RecusadoPelaPlataforma } from '../nucleo/erros';
import { htmlParaTexto, urlHttps } from '../nucleo/texto';

// Catálogo interno da Kentro, para a loja que não tem e-commerce. A Kentro não oferece leitura de produtos
// para servidores sem um token; quem lê é a extensão (omni.products.list, com a sessão do usuário logado),
// que envia uma cópia para a API (rotas /v1/loja/catalogo-kentro). Este conector lê essa cópia.

type Bruto = Record<string, unknown>;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const verdadeiro = (v: unknown): boolean => v === true || v === 1 || v === '1';

/**
 * Produto como o SDK da extensão entrega (omni.products.list): {id, name, description, internalCode, value,
 * price, measurementUnit, groupIds, available, hiddenFromClients, imageUrl}, com valores na unidade da moeda.
 * Oculto para clientes ou sem id/nome: null (não entra no catálogo).
 */
export function produtoDoSdk(p: Bruto): Produto | null {
  const id = texto(p.id);
  const nome = texto(p.name).slice(0, 200);
  if (!/^\d{1,18}$/.test(id) || !nome || verdadeiro(p.hiddenFromClients)) return null;
  const valor = Number(p.price ?? p.value);
  const imagem = urlHttps(texto(p.imageUrl));
  return {
    id,
    sku: texto(p.internalCode).slice(0, 80) || id,
    nome,
    descricao: htmlParaTexto(texto(p.description)).slice(0, 2000),
    imagens: imagem ? [imagem] : [],
    preco: Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0,
    unidade: texto(p.measurementUnit).toUpperCase().slice(0, 10) || 'UN',
    // O SDK não informa a quantidade em estoque, só se o produto está disponível.
    estoque: null,
    // Sem preço cadastrado continua disponível: serve ao catálogo sem preço (lista para orçamento).
    // Com preços visíveis, o carrinho recusa produto sem preço.
    disponivel: verdadeiro(p.available),
    categoriaIds: (Array.isArray(p.groupIds) ? p.groupIds : []).map(texto).filter((g) => /^\d{1,18}$/.test(g)),
    variacoes: [],
  };
}

function copia(ctx: CtxConector): CatalogoLocal {
  if (!ctx.catalogoLocal) throw new RecusadoPelaPlataforma('O catálogo da Kentro não está disponível agora.');
  return ctx.catalogoLocal;
}

export const conectorKentro: Conector = {
  id: 'kentro',
  nome: 'Catálogo da Kentro',
  ritmo: { porSegundo: 20, rajada: 40 },
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: false,
    estoque: false,
    relacionados: false,
    cotarFrete: false,
    criarPedido: false,
    oauth: false,
    historicoCliente: false,
  },
  // Nada a preencher: os produtos chegam pela extensão, com a permissão de quem está logado na Kentro.
  camposDeCredencial: [],

  async testarConexao(ctx) {
    const { sincronizadoEm, total } = await copia(ctx).estado();
    if (!sincronizadoEm) return { ok: false, mensagem: 'O catálogo da Kentro ainda não foi sincronizado. Clique em "Sincronizar agora".' };
    if (!total) {
      return { ok: false, mensagem: 'A sincronização não trouxe nenhum produto. Confira se há produtos cadastrados e visíveis para clientes na Kentro.' };
    }
    return { ok: true, nomeLoja: `Catálogo da Kentro (${total} ${total === 1 ? 'produto' : 'produtos'})` };
  },

  listarCategorias: async (ctx) => copia(ctx).categorias(),
  listarProdutos: async (ctx, filtro) => copia(ctx).produtos(filtro),
  obterProduto: async (ctx, id) => copia(ctx).produto(id.trim()),
};
