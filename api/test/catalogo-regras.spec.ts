import { CatalogoService } from '../src/catalogo/catalogo.service';
import { Produto } from '../src/contratos/modelo';
import { IntegracoesService } from '../src/integracoes/integracoes.service';
import { RegraPublica, RegrasService } from '../src/regras/regras.service';

// Regras que vêm do conector (ex.: Demonstração) são a base; as gravadas pela loja têm prioridade.

const piso: Produto = {
  id: 'P1',
  sku: 'P1',
  nome: 'Porcelanato',
  descricao: '',
  imagens: [],
  preco: 100,
  unidade: 'CX',
  estoque: 10,
  disponivel: true,
  categoriaIds: [],
  variacoes: [],
  regras: { selo: 'Mais vendido', m2PorUnidade: 1.44, compreJunto: ['ARG'] },
};

function montar(regraDaLoja?: Partial<RegraPublica>) {
  const conector = {
    capacidades: { relacionados: true },
    obterProduto: async () => structuredClone(piso),
    listarProdutos: async () => ({ itens: [structuredClone(piso)], pagina: 1, porPagina: 24, temMais: false }),
    relacionados: async () => [{ ...piso, id: 'ARG', sku: 'ARG' }],
  };
  const integracoes = { contexto: async () => ({ conector, ctx: {} }) } as unknown as IntegracoesService;
  const regras = {
    porSkus: async () => new Map(regraDaLoja ? [['P1', { compreJunto: [], ...regraDaLoja } as RegraPublica]] : []),
  } as unknown as RegrasService;
  return new CatalogoService(integracoes, regras);
}

describe('regras do catálogo', () => {
  it('obterProduto mantém as regras do conector quando a loja não gravou nenhuma', async () => {
    const p = await montar().obterProduto('l1', 'P1');
    expect(p.regras).toEqual({ selo: 'Mais vendido', m2PorUnidade: 1.44, compreJunto: ['ARG'] });
  });

  it('a regra gravada pela loja tem prioridade, campo a campo', async () => {
    const p = await montar({ selo: 'Oferta', compreJunto: ['REJ'] }).obterProduto('l1', 'P1');
    expect(p.regras).toEqual({ selo: 'Oferta', m2PorUnidade: 1.44, compreJunto: ['REJ', 'ARG'] });
  });

  it('na listagem também', async () => {
    const lista = await montar({ rendimentoM2: 4 }).listarProdutos('l1', { pagina: 1 });
    expect(lista.itens[0].regras).toEqual({ selo: 'Mais vendido', m2PorUnidade: 1.44, rendimentoM2: 4, compreJunto: ['ARG'] });
  });
});
