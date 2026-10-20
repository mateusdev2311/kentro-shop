import { moeda } from '../sessoes/calculo';
import { Produto, Variacao } from '../contratos/modelo';

// Variações para a IA: ela escolhe pelo NOME ("Preto / G"), não pelo id. Copiar um id numa lista de dezenas de
// cores e tamanhos fazia o modelo trocar G por GG; o nome é conferido aqui palavra a palavra.

/** "Preto / G" → ["g", "preto"]: sem acento, caixa, pontuação ou ordem. */
export function palavras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort();
}

const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/** A variação tem exatamente estas palavras (no nome ou nos valores dos atributos)? "G" nunca casa com "GG". */
export function mesmaVariacao(pedido: string, v: { nome: string; atributos?: Record<string, string> }): boolean {
  const alvo = palavras(pedido);
  if (!alvo.length) return false;
  if (iguais(alvo, palavras(v.nome))) return true;
  const valores = Object.values(v.atributos ?? {});
  return valores.length > 0 && iguais(alvo, palavras(valores.join(' ')));
}

export function encontrarVariacao(produto: Produto, pedido: string): Variacao | null {
  return produto.variacoes.find((v) => mesmaVariacao(pedido, v)) ?? null;
}

const esgotada = (v: Variacao) => !v.disponivel || v.estoque === 0;

/** Opções válidas, para a IA corrigir o pedido. */
export function opcoesDe(produto: Produto, max = 40): string {
  const nomes = produto.variacoes.map((v) => (esgotada(v) ? `${v.nome} (esgotada)` : v.nome));
  return nomes.slice(0, max).join('; ') + (nomes.length > max ? `; … e mais ${nomes.length - max}` : '');
}

/** Todas as variações com o mesmo preço? Então o preço vai uma vez só, na linha do produto. */
export function precoUnico(produto: Produto): { preco: number; precoDe?: number } | null {
  if (!produto.variacoes.length) return null;
  const [primeira] = produto.variacoes;
  const mesmo = produto.variacoes.every((v) => v.preco === primeira.preco && (v.precoDe ?? 0) === (primeira.precoDe ?? 0));
  return mesmo ? { preco: primeira.preco, ...(primeira.precoDe ? { precoDe: primeira.precoDe } : {}) } : null;
}

function precoTexto(p: { preco: number; precoDe?: number }): string {
  if (!(p.preco > 0)) return 'sem preço';
  return p.precoDe && p.precoDe > p.preco ? `${moeda(p.preco)} (de ${moeda(p.precoDe)})` : moeda(p.preco);
}

const estoqueTexto = (v: Variacao) => (esgotada(v) ? 'esgotada' : v.estoque === null ? 'disponível' : `${v.estoque}`);

/**
 * Linhas das variações. Com dois atributos (ex.: cor e tamanho), agrupa pelo primeiro:
 * "Preto: M (25) · G (28) · GG (10) · esgotado: P". Preço por variação só quando ele muda entre elas.
 */
export function linhasDeVariacoes(produto: Produto, mostrarPrecos: boolean, max = 60): string[] {
  const variacoes = produto.variacoes.slice(0, max);
  const [primeiro, segundo] = produto.atributosVariacao ?? [];
  const comPreco = mostrarPrecos && !precoUnico(produto);
  const agrupavel = primeiro && segundo && !comPreco && variacoes.every((v) => v.atributos?.[primeiro] && v.atributos?.[segundo]);
  const linhas: string[] = [];
  if (agrupavel) {
    const grupos = new Map<string, Variacao[]>();
    for (const v of variacoes) grupos.set(v.atributos[primeiro], [...(grupos.get(v.atributos[primeiro]) ?? []), v]);
    for (const [valor, lista] of grupos) {
      const disponiveis = lista.filter((v) => !esgotada(v)).map((v) => `${v.atributos[segundo]} (${estoqueTexto(v)})`);
      const sem = lista.filter(esgotada).map((v) => v.atributos[segundo]);
      const partes = [...disponiveis, ...(sem.length ? [`esgotado: ${sem.join(', ')}`] : [])];
      linhas.push(`- ${valor}: ${partes.join(' · ')}`);
    }
  } else {
    for (const v of variacoes) {
      linhas.push(`- ${[v.nome, comPreco ? precoTexto(v) : '', esgotada(v) ? 'esgotada' : `estoque ${estoqueTexto(v)}`].filter(Boolean).join(' · ')}`);
    }
  }
  if (produto.variacoes.length > max) linhas.push(`- … e mais ${produto.variacoes.length - max} opções (veja detalhes_produto).`);
  return linhas;
}
