import { createHash } from 'node:crypto';
import { Categoria, Produto } from '../../contratos/modelo';
import { camposMysql, ClienteBanco, destinoBanco, Linha, lerCredenciaisBanco } from '../nucleo/banco';
import { CatalogoLocal, Conector, CtxConector, ProdutoSincronizado } from '../nucleo/conector';
import { RecusadoPelaPlataforma } from '../nucleo/erros';

// ERP Automatiza (farmácias): o ERP libera views "view_ecommerce_delivery_*" num MySQL, para um usuário
// ligado a uma filial (as views já vêm filtradas pela filial logada). Ler a view de produtos custa alguns
// segundos por consulta, qualquer que seja o filtro: a API copia o catálogo de tempos em tempos e o
// conector lê a cópia. Por enquanto só leitura; o pedido segue com o atendente.

export const VIEW_PRODUTOS = 'view_ecommerce_delivery_produtos';
export const VIEW_FILIAL_LOGADA = 'view_ecommerce_delivery_filial_logada';
const BANCO_PADRAO = 'automatiza';
/** Proteção de memória: a leitura traz o catálogo vendável inteiro de uma vez. */
export const MAX_PRODUTOS = 100_000;

/** Grupos e subgrupos de uso interno do ERP, que não são vendidos ao cliente (ex.: taxa de entrega). */
const GRUPOS_FORA_DA_VENDA = new Set(['USO E CONSUMO', 'ATIVO IMOBILIZADO', 'ENTREGAS', 'MATERIA PRIMA', 'CONSUMO', 'ATUALIZAR']);
const SIGLAS = new Set(['OTC', 'RX', 'PBM', 'PET', 'AC', 'UV']);
const MINUSCULAS = new Set(['e', 'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em']);

const texto = (v: unknown): string => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const numero = (v: unknown): number => {
  const n = Number(texto(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const centavos = (n: number): number => Math.round(n * 100) / 100;
const chave = (s: string): string =>
  texto(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

/** "HIGIENE E BELEZA" -> "Higiene e Beleza"; "ETICO_RX" -> "Etico RX". */
export function titulo(nome: string): string {
  return texto(nome.replace(/_/g, ' '))
    .toLowerCase()
    .split(' ')
    .map((p, i) => (SIGLAS.has(p.toUpperCase()) ? p.toUpperCase() : i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** O mesmo subgrupo em grupos diferentes (ex.: Dermocosméticos) vira uma categoria só. Id estável pelo nome. */
export function idCategoria(subgrupo: string): string {
  return `sg-${createHash('sha1').update(chave(subgrupo)).digest('hex').slice(0, 12)}`;
}

/**
 * Linha da view de produtos no formato do contrato. Fica de fora (null): inativo, sem estoque, sem preço de
 * delivery, grupo de uso interno e controlado (antibiótico e psicotrópico exigem a retenção da receita).
 */
export function produtoDaView(l: Linha): ProdutoSincronizado | null {
  const id = texto(l.codigo_mercadoria);
  const nome = texto(l.descricao).slice(0, 200);
  if (!/^\d{1,18}$/.test(id) || !nome) return null;
  if (chave(texto(l.situacao)) !== 'ATIVO') return null;
  if (texto(l.cotrole_especial).toLowerCase() === 'true' || texto(l.tipo_controle)) return null;
  if (GRUPOS_FORA_DA_VENDA.has(chave(texto(l.grupo_principal))) || GRUPOS_FORA_DA_VENDA.has(chave(texto(l.subgrupo)))) return null;

  const preco = centavos(numero(l.preco_venda_delivery));
  const estoque = Math.floor(numero(l.estoque));
  if (preco <= 0 || estoque <= 0) return null;
  const precoTabela = centavos(numero(l.preco_venda));
  const laboratorio = texto(l.laboratorio);
  const subgrupo = texto(l.subgrupo);
  const ean = texto(l.EAN).replace(/\D/g, '');

  const produto: Produto = {
    id,
    // O código da mercadoria é o que o ERP usa para lançar o pedido.
    sku: id,
    nome,
    descricao: laboratorio ? `Laboratório: ${laboratorio}` : '',
    imagens: [],
    preco,
    ...(precoTabela > preco ? { precoDe: precoTabela } : {}),
    unidade: 'UN',
    estoque,
    disponivel: true,
    categoriaIds: subgrupo ? [idCategoria(subgrupo)] : [],
    variacoes: [],
  };
  return { produto, ...(ean ? { termos: ean } : {}) };
}

/** Categorias dos produtos que entraram, em ordem alfabética. */
export function categoriasDaView(linhas: Linha[], usadas: Set<string>): Categoria[] {
  const porId = new Map<string, Categoria>();
  for (const l of linhas) {
    const subgrupo = texto(l.subgrupo);
    const id = subgrupo ? idCategoria(subgrupo) : '';
    if (id && usadas.has(id) && !porId.has(id)) porId.set(id, { id, nome: titulo(subgrupo).slice(0, 80) });
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function banco(ctx: CtxConector): ClienteBanco {
  if (!ctx.banco) throw new RecusadoPelaPlataforma('O banco de dados da loja não está disponível agora.');
  return ctx.banco;
}

function copia(ctx: CtxConector): CatalogoLocal {
  if (!ctx.catalogoLocal) throw new RecusadoPelaPlataforma('O catálogo sincronizado não está disponível agora.');
  return ctx.catalogoLocal;
}

export const conectorAutomatiza: Conector = {
  id: 'automatiza',
  nome: 'ERP Automatiza (banco de dados)',
  ritmo: { porSegundo: 20, rajada: 40 },
  banco: { motor: 'mysql', bancoPadrao: BANCO_PADRAO },
  sincronizacao: { minutos: 15 },
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: false,
    estoque: true,
    relacionados: false,
    cotarFrete: false,
    criarPedido: false,
    oauth: false,
    historicoCliente: false,
  },
  camposDeCredencial: camposMysql(BANCO_PADRAO),

  destino: destinoBanco,

  validarCredenciais(c) {
    const lidas = lerCredenciaisBanco(c, BANCO_PADRAO);
    return typeof lidas === 'string' ? lidas : null;
  },

  async testarConexao(ctx) {
    const [filial] = await banco(ctx).consultar('testar_conexao', `SELECT codigo_filial, filial_fantasia FROM ${VIEW_FILIAL_LOGADA} LIMIT 1`);
    if (!filial) {
      return { ok: false, mensagem: 'O banco respondeu, mas o usuário não está ligado a nenhuma filial. Peça ao responsável pelo ERP para configurar a filial desse usuário.' };
    }
    const nomeFilial = texto(filial.filial_fantasia) || `Filial ${texto(filial.codigo_filial)}`;
    const { sincronizadoEm, total } = await copia(ctx).estado();
    if (!sincronizadoEm) return { ok: false, mensagem: `Banco conectado (${nomeFilial}), mas os produtos ainda não foram sincronizados. Clique em "Sincronizar agora".` };
    if (!total) return { ok: false, mensagem: `Banco conectado (${nomeFilial}), mas nenhum produto ativo com estoque e preço de delivery foi encontrado.` };
    return { ok: true, nomeLoja: `${nomeFilial} (${total} ${total === 1 ? 'produto' : 'produtos'})` };
  },

  async lerCatalogoCompleto(ctx) {
    // Filtrar no SQL não deixa a view mais rápida, mas reduz o que trafega (a maior parte não tem estoque).
    const linhas = await banco(ctx).consultar(
      'sincronizar_catalogo',
      `SELECT codigo_mercadoria, EAN, descricao, preco_venda, preco_venda_delivery, estoque, laboratorio,
              grupo_principal, subgrupo, cotrole_especial, tipo_controle, situacao
         FROM ${VIEW_PRODUTOS}
        WHERE situacao = ? AND estoque > 0
        LIMIT ${MAX_PRODUTOS + 1}`,
      ['ATIVO'],
      { timeoutMs: 120_000 },
    );
    if (linhas.length > MAX_PRODUTOS) {
      throw new RecusadoPelaPlataforma(`O catálogo passa de ${MAX_PRODUTOS} produtos com estoque, acima do que o Kentro Shop sincroniza.`);
    }
    const produtos = linhas.map(produtoDaView).filter((p): p is ProdutoSincronizado => !!p);
    const usadas = new Set(produtos.flatMap((p) => p.produto.categoriaIds));
    return { produtos, categorias: categoriasDaView(linhas, usadas) };
  },

  listarCategorias: async (ctx) => copia(ctx).categorias(),
  listarProdutos: async (ctx, filtro) => copia(ctx).produtos(filtro),
  obterProduto: async (ctx, id) => copia(ctx).produto(id.trim()),
};
