import { Categoria, Pagina, Produto, Variacao } from '../../contratos/modelo';
import { Conector, CtxConector, FiltroProdutos } from '../nucleo/conector';
import { CredencialInvalida, NaoEncontrado, RecusadoPelaPlataforma } from '../nucleo/erros';
import { htmlParaTexto, numero, urlHttps } from '../nucleo/texto';

// Conector da Nuvemshop: app de parceiro com OAuth. O lojista autoriza o app; o token (que não expira) e o
// store_id ficam gravados cifrados. API REST com "Authorization: Bearer" e User-Agent com contato obrigatório.
// Formato da documentação oficial (tiendanube.github.io/api-documentation); ainda sem respostas reais gravadas.

type Bruto = Record<string, unknown>;

export const VERSAO_API = '2025-03';
export const BASE_API = `https://api.nuvemshop.com.br/${VERSAO_API}`;
const AUTORIZAR = 'https://www.nuvemshop.com.br/apps';
export const URL_TOKEN = 'https://www.tiendanube.com/apps/authorize/token';
const MAX_POR_PAGINA = 200;
const RECUSADO = 'A Nuvemshop recusou o acesso. Conecte a loja de novo em Kentro Shop > Integração.';

export interface AppNuvemshop {
  appId: string;
  clientSecret: string;
  /** "Kentro Shop (https://…)": a Nuvemshop recusa chamada sem User-Agent com contato. */
  userAgent: string;
}

const lista = (v: unknown): Bruto[] => (Array.isArray(v) ? (v as Bruto[]) : []);
const obj = (v: unknown): Bruto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : {});
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** Campos multilíngues ({ pt: "…", es: "…" }): português primeiro. */
export function idioma(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return texto(v);
  const o = obj(v);
  return texto(o.pt ?? o['pt-BR'] ?? o.es ?? o.en ?? Object.values(o)[0]);
}

function precoDaVariante(v: Bruto): { preco: number; precoDe?: number } {
  const cheio = numero(v.price) ?? 0;
  const promocional = numero(v.promotional_price);
  if (promocional && promocional > 0 && promocional < cheio) return { preco: promocional, precoDe: cheio };
  return { preco: cheio };
}

/** stock_management falso = estoque infinito (null); verdadeiro = a quantidade em stock. */
const estoqueDa = (v: Bruto): number | null => (v.stock_management ? Math.max(0, numero(v.stock) ?? 0) : null);

export function produtoDaNuvemshop(p: Bruto): Produto {
  const id = texto(p.id);
  const variantes = lista(p.variants);
  const atributos = lista(p.attributes).map(idioma).filter(Boolean);
  const fotos = lista(p.images).sort((a, b) => (numero(a.position) ?? 0) - (numero(b.position) ?? 0));
  const imagens = fotos.map((i) => urlHttps(texto(i.src))).filter((u): u is string => !!u);
  const fotoPorId = new Map(fotos.map((i) => [texto(i.id), urlHttps(texto(i.src))]));
  const publicado = p.published !== false;
  const urlNaLoja = urlHttps(texto(p.canonical_url));
  const base = {
    id,
    nome: idioma(p.name),
    descricao: htmlParaTexto(idioma(p.description)),
    imagens,
    unidade: 'UN',
    categoriaIds: lista(p.categories).map((c) => texto(c.id)).filter(Boolean),
    ...(urlNaLoja ? { urlNaLoja } : {}),
  };

  if (variantes.length <= 1) {
    const v = variantes[0] ?? {};
    const { preco, precoDe } = precoDaVariante(v);
    const estoque = estoqueDa(v);
    return {
      ...base,
      sku: texto(v.sku) || id,
      preco,
      ...(precoDe ? { precoDe } : {}),
      estoque,
      disponivel: publicado && preco > 0 && (estoque === null || estoque > 0),
      variacoes: [],
    };
  }

  const variacoes: Variacao[] = variantes.map((v) => {
    const vid = texto(v.id);
    const valores = lista(v.values).map(idioma);
    const { preco, precoDe } = precoDaVariante(v);
    const estoque = estoqueDa(v);
    const imagem = fotoPorId.get(texto(v.image_id));
    return {
      id: vid,
      sku: texto(v.sku) || `${id}-${vid}`,
      nome: valores.filter(Boolean).join(' / ') || vid,
      atributos: Object.fromEntries(atributos.map((a, i) => [a, valores[i] ?? ''])),
      preco,
      ...(precoDe ? { precoDe } : {}),
      estoque,
      disponivel: preco > 0 && (estoque === null || estoque > 0),
      ...(imagem ? { imagem } : {}),
    };
  });
  const vendaveis = variacoes.filter((v) => v.disponivel);
  const precos = (vendaveis.length ? vendaveis : variacoes).map((v) => v.preco).filter((n) => n > 0);
  const estoques = variacoes.map((v) => v.estoque);
  return {
    ...base,
    // Regras da loja (selo, m², compre junto) são por SKU; produto com variações usa o id.
    sku: id,
    preco: precos.length ? Math.min(...precos) : 0,
    estoque: estoques.every((e): e is number => typeof e === 'number') ? estoques.reduce((s, e) => s + e, 0) : null,
    disponivel: publicado && vendaveis.length > 0,
    variacoes,
    ...(atributos.length ? { atributosVariacao: atributos } : {}),
  };
}

export function criarConectorNuvemshop(app: AppNuvemshop): Conector {
  const cabecalhos = (ctx: CtxConector) => ({ Authorization: `Bearer ${texto(ctx.credenciais.access_token)}`, 'User-Agent': app.userAgent });

  function loja(ctx: CtxConector): string {
    const id = texto(ctx.credenciais.store_id);
    if (!/^\d+$/.test(id) || !texto(ctx.credenciais.access_token)) throw new RecusadoPelaPlataforma(RECUSADO);
    return id;
  }

  async function get(ctx: CtxConector, operacao: string, caminho: string, consulta: Record<string, string | number | undefined> = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(consulta)) if (v !== undefined && v !== '') q.set(k, String(v));
    const s = q.toString();
    return ctx.http.requisitar({ metodo: 'GET', url: `${BASE_API}/${loja(ctx)}${caminho}${s ? `?${s}` : ''}`, operacao, cabecalhos: cabecalhos(ctx) });
  }

  async function produtoPorId(ctx: CtxConector, id: string): Promise<Produto | null> {
    try {
      const r = await get(ctx, 'produto', `/products/${id}`);
      const p = obj(r.corpo);
      return p.id && p.published !== false ? produtoDaNuvemshop(p) : null;
    } catch (e) {
      if (e instanceof NaoEncontrado) return null;
      throw e;
    }
  }

  return {
    id: 'nuvemshop',
    nome: 'Nuvemshop',
    // Leaky bucket da Nuvemshop: 40 de capacidade, 2 por segundo por loja e app.
    ritmo: { porSegundo: 2, rajada: 20 },
    capacidades: {
      buscaTextual: true,
      categorias: true,
      variacoes: true,
      estoque: true,
      relacionados: false,
      cotarFrete: false,
      criarPedido: false,
      oauth: true,
      historicoCliente: false,
    },
    // Nada a digitar: o lojista autoriza o app na Nuvemshop (botão "Conectar").
    camposDeCredencial: [],

    idExterno: (credenciais) => (/^\d+$/.test(texto(credenciais.store_id)) ? texto(credenciais.store_id) : null),

    urlDeAutorizacao: (estado) => `${AUTORIZAR}/${app.appId}/authorize?state=${encodeURIComponent(estado)}`,

    async concluirAutorizacao(ctx, params) {
      const code = texto(params.code);
      if (!code) throw new RecusadoPelaPlataforma('A Nuvemshop não enviou a autorização. Tente conectar de novo.');
      const r = await ctx.http.requisitar({
        metodo: 'POST',
        url: URL_TOKEN,
        operacao: 'oauthToken',
        cabecalhos: { 'User-Agent': app.userAgent },
        corpo: { client_id: app.appId, client_secret: app.clientSecret, grant_type: 'authorization_code', code },
      });
      const corpo = obj(r.corpo);
      const token = texto(corpo.access_token);
      const loja = texto(corpo.user_id ?? corpo.store_id);
      // Código vencido ou já usado: a Nuvemshop responde com "error" em vez do token.
      if (!token || !/^\d+$/.test(loja)) {
        throw new RecusadoPelaPlataforma('A Nuvemshop não confirmou a autorização (o link pode ter expirado). Tente conectar de novo.');
      }
      return { access_token: token, store_id: loja, escopo: texto(corpo.scope) };
    },

    async testarConexao(ctx) {
      try {
        const r = await get(ctx, 'loja', '/store', { fields: 'name' });
        return { ok: true, nomeLoja: idioma(obj(r.corpo).name) || undefined };
      } catch (e) {
        if (e instanceof CredencialInvalida) return { ok: false, mensagem: RECUSADO };
        throw e;
      }
    },

    async listarCategorias(ctx): Promise<Categoria[]> {
      const categorias: Categoria[] = [];
      for (let pagina = 1; pagina <= 10; pagina++) {
        let itens: Bruto[];
        try {
          itens = lista((await get(ctx, 'categorias', '/categories', { page: pagina, per_page: MAX_POR_PAGINA, fields: 'id,name,parent' })).corpo);
        } catch (e) {
          if (e instanceof NaoEncontrado) break; // a Nuvemshop responde 404 depois da última página
          throw e;
        }
        for (const c of itens) {
          const paiId = texto(c.parent);
          categorias.push({ id: texto(c.id), nome: idioma(c.name), ...(paiId && paiId !== '0' ? { paiId } : {}) });
        }
        if (itens.length < MAX_POR_PAGINA) break;
      }
      return categorias.filter((c) => c.id && c.nome);
    },

    async listarProdutos(ctx, filtro: FiltroProdutos): Promise<Pagina<Produto>> {
      const porPagina = Math.min(filtro.porPagina, MAX_POR_PAGINA);
      const vazia = { itens: [], pagina: filtro.pagina, porPagina, temMais: false };
      if (filtro.categoriaId && !/^\d+$/.test(filtro.categoriaId)) return vazia;
      let r;
      try {
        r = await get(ctx, 'produtos', '/products', {
          page: filtro.pagina,
          per_page: porPagina,
          published: 'true',
          q: filtro.busca?.trim().slice(0, 100),
          category_id: filtro.categoriaId,
        });
      } catch (e) {
        if (e instanceof NaoEncontrado) return vazia; // página depois da última ou busca sem resultado
        throw e;
      }
      const itens = lista(r.corpo).map(produtoDaNuvemshop);
      const total = Number(r.cabecalhos?.['x-total-count']);
      return {
        itens,
        pagina: filtro.pagina,
        porPagina,
        ...(Number.isFinite(total) ? { total } : {}),
        temMais: Number.isFinite(total) ? (filtro.pagina - 1) * porPagina + itens.length < total : itens.length === porPagina,
      };
    },

    /** Pelo id da Nuvemshop ou pelo SKU de uma variante. Despublicado ou inexistente: null. */
    async obterProduto(ctx, id): Promise<Produto | null> {
      const chave = id.trim();
      if (!chave) return null;
      if (/^\d+$/.test(chave)) return produtoPorId(ctx, chave);
      try {
        const p = obj((await get(ctx, 'produtoPorSku', `/products/sku/${encodeURIComponent(chave)}`)).corpo);
        return p.id && p.published !== false ? produtoDaNuvemshop(p) : null;
      } catch (e) {
        if (e instanceof NaoEncontrado) return null;
        throw e;
      }
    },
  };
}
