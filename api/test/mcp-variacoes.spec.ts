import { Produto, Variacao } from '../src/contratos/modelo';
import { encontrarVariacao, linhasDeVariacoes, mesmaVariacao } from '../src/mcp/variacoes';

const v = (id: string, cor: string, tam: string, estoque: number, preco = 60.99): Variacao => ({
  id,
  sku: id,
  nome: `${cor} / ${tam}`,
  atributos: { cor, Tamanho: tam },
  preco,
  precoDe: 70.99,
  estoque,
  disponivel: estoque > 0,
});

const polo: Produto = {
  id: 'p1',
  sku: 'p1',
  nome: 'Polo',
  descricao: '',
  imagens: [],
  preco: 60.99,
  unidade: 'UN',
  estoque: null,
  disponivel: true,
  categoriaIds: [],
  atributosVariacao: ['cor', 'Tamanho'],
  variacoes: [v('1', 'Preto', 'M', 25), v('2', 'Preto', 'G', 28), v('3', 'Preto', 'GG', 10), v('4', 'Preto', 'P', 0), v('5', 'Branco', 'M', 51)],
};

describe('variações pelo nome (MCP)', () => {
  it('G nunca casa com GG; ordem, acento e caixa não importam', () => {
    expect(encontrarVariacao(polo, 'Preto / G')?.id).toBe('2');
    expect(encontrarVariacao(polo, 'g preto')?.id).toBe('2');
    expect(encontrarVariacao(polo, 'PRETO-GG')?.id).toBe('3');
    expect(encontrarVariacao(polo, 'Preto')).toBeNull();
    expect(encontrarVariacao(polo, 'Preto G G')).toBeNull();
    expect(mesmaVariacao('Calção', { nome: 'calcao' })).toBe(true);
    expect(mesmaVariacao('', { nome: 'x' })).toBe(false);
  });

  it('agrupa por cor quando há dois atributos e o preço é o mesmo', () => {
    expect(linhasDeVariacoes(polo, true)).toEqual(['- Preto: M (25) · G (28) · GG (10) · esgotado: P', '- Branco: M (51)']);
  });

  it('preço diferente entre opções: uma linha por opção, com o preço', () => {
    const misto = { ...polo, variacoes: [v('1', 'Preto', 'M', 2, 50), v('2', 'Preto', 'G', 0, 55)] };
    expect(linhasDeVariacoes(misto, true)).toEqual(['- Preto / M · R$ 50,00 (de R$ 70,99) · estoque 2', '- Preto / G · R$ 55,00 (de R$ 70,99) · esgotada']);
    expect(linhasDeVariacoes(misto, false)).toEqual(['- Preto: M (2) · esgotado: G']);
  });
});
