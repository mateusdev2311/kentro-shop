import { Categoria, Produto, Variacao } from '../../contratos/modelo';
import { htmlParaTexto, numero, urlHttps } from '../nucleo/texto';

// Tradução das respostas da eCommerce-net para o modelo do Kentro Shop.
// A plataforma devolve números como texto ("129.90", "54,90", "", null): tudo passa por numero().

type Bruto = Record<string, unknown>;

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/** "0.00", vazio, nulo ou maior/igual ao preço não é promoção. */
function precos(price: unknown, promotional: unknown, precoPadrao?: number): { preco: number; precoDe?: number } {
  const cheio = numero(price) ?? precoPadrao ?? 0;
  const promocao = numero(promotional);
  if (promocao !== null && promocao > 0 && promocao < cheio) return { preco: promocao, precoDe: cheio };
  return { preco: cheio };
}

function imagens(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : texto(v).split(',');
  return lista
    .map((item) => urlHttps(typeof item === 'object' && item !== null ? texto((item as Bruto).url) : texto(item)))
    .filter((url): url is string => !!url);
}

function ativo(status: unknown): boolean {
  const s = numero(status);
  return s === null || s === 1;
}

/** Produto com variações: tipo 4 na eCommerce-net ou com título de variação. */
export function temVariacao(raw: Bruto): boolean {
  return texto(raw.type) === '4' || !!texto(raw.variety_title);
}

export function produtoDeEcn(raw: Bruto): Produto {
  const estoque = numero(raw.stock);
  const categoria = texto(raw.category_id);
  const titulo = texto(raw.variety_title);
  const curta = htmlParaTexto(texto(raw.short_description));
  // A eCommerce-net é toda indexada por SKU: ele é o id do produto no Kentro Shop.
  const sku = texto(raw.sku);
  const valores = precos(raw.price, raw.promotional_price);
  return {
    id: sku,
    sku,
    nome: texto(raw.name),
    descricao: htmlParaTexto(texto(raw.description)),
    ...(curta ? { descricaoCurta: curta } : {}),
    imagens: imagens(raw.product_images ?? raw.images ?? raw.image),
    ...valores,
    unidade: texto(raw.unit_measurement).toUpperCase() || 'UN',
    estoque,
    // Sem preço válido não dá para vender: o carrinho seria fechado a zero.
    disponivel: ativo(raw.status) && valores.preco > 0 && (estoque === null || estoque > 0),
    categoriaIds: categoria ? [categoria] : [],
    variacoes: [],
    ...(titulo ? { atributosVariacao: [titulo] } : {}),
  };
}

export function variacaoDeEcn(raw: Bruto, titulo: string, pai: Produto): Variacao {
  const estoque = numero(raw.stock);
  const sku = texto(raw.sku);
  const nome = texto(raw.variety_name ?? raw.name) || sku;
  const imagem = urlHttps(texto(raw.image ?? raw.product_images));
  const valores = precos(raw.price, raw.promotional_price, pai.precoDe ?? pai.preco);
  return {
    id: texto(raw.id_variety ?? raw.id) || sku,
    sku,
    nome,
    atributos: { [titulo || 'Opção']: nome },
    ...valores,
    estoque,
    disponivel: ativo(raw.status) && valores.preco > 0 && (estoque === null || estoque > 0),
    ...(imagem ? { imagem } : {}),
  };
}

export function categoriaDeEcn(raw: Bruto): Categoria {
  const ordem = numero(raw.sort);
  const pai = texto(raw.parent_id);
  return {
    id: texto(raw.id),
    nome: texto(raw.name),
    ...(ordem !== null ? { ordem } : {}),
    ...(pai && pai !== '0' ? { paiId: pai } : {}),
  };
}

export function categoriaAtiva(raw: Bruto): boolean {
  return ativo(raw.status);
}
