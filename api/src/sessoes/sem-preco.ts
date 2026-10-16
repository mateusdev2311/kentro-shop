import { Pagina, Produto } from '../contratos/modelo';
import { SessaoPublica } from './tipos';

// Catálogo sem preço: o preço sai das RESPOSTAS públicas (não só da tela). Internamente nada muda:
// o carrinho continua revalidando preço e estoque, e o atendente vê os valores no painel.

export const precosVisiveis = (sessao: { mostrarPrecos: boolean | null }, padraoDaLoja: boolean) => sessao.mostrarPrecos ?? padraoDaLoja;

export function produtoSemPreco(p: Produto): Produto {
  const { precoDe: _de, ...resto } = p;
  return {
    ...resto,
    preco: 0,
    variacoes: p.variacoes.map(({ precoDe: _v, ...v }) => ({ ...v, preco: 0 })),
  };
}

export function paginaSemPreco(pagina: Pagina<Produto>): Pagina<Produto> {
  return { ...pagina, itens: pagina.itens.map(produtoSemPreco) };
}

export function sessaoSemPreco<T extends SessaoPublica>(s: T): T {
  return {
    ...s,
    itens: s.itens.map((i) => ({ ...i, precoUnitario: 0, subtotal: 0 })),
    totais: { ...s.totais, subtotal: 0, frete: null, desconto: 0, total: 0 },
  };
}
