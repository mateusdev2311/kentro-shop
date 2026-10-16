import { conectorDemonstracao } from '../../src/conectores/demonstracao/demonstracao.conector';
import { CtxConector } from '../../src/conectores/nucleo/conector';

const ctx: CtxConector = {
  lojaId: 'demo',
  credenciais: { codigo: 'demo' },
  http: { requisitar: () => Promise.reject(new Error('o conector de demonstração não faz HTTP')) },
  salvarCredenciais: async () => undefined,
};

describe('conector Demonstração', () => {
  it('pede só o código "demo" e explica isso', () => {
    expect(conectorDemonstracao.camposDeCredencial).toEqual([
      expect.objectContaining({ chave: 'codigo', tipo: 'texto', obrigatorio: true, ajuda: 'Digite demo para usar os produtos de exemplo.' }),
    ]);
  });

  it('busca sem acento e sem diferenciar maiúsculas', async () => {
    const r = await conectorDemonstracao.listarProdutos(ctx, { busca: 'VINILICO', pagina: 1, porPagina: 24 });
    expect(r.itens.length).toBeGreaterThan(0);
    expect(r.itens.every((p) => /vin[ií]lico/i.test(`${p.nome} ${p.descricaoCurta}`))).toBe(true);
  });

  it('filtra por categoria e traz as regras de exemplo (selo e m² por caixa)', async () => {
    const r = await conectorDemonstracao.listarProdutos(ctx, { categoriaId: '1', pagina: 1, porPagina: 24 });
    expect(r.itens.every((p) => p.categoriaIds.includes('1'))).toBe(true);
    const calacata = (await conectorDemonstracao.obterProduto(ctx, 'PRC-6060-CAL'))!;
    expect(calacata.regras).toMatchObject({ m2PorUnidade: 1.44, compreJunto: ['ARG-AC3-20', 'REJ-EPX-1KG', 'ACS-NIV-KIT'] });
  });

  it('relacionados vêm do compre junto de exemplo', async () => {
    const r = await conectorDemonstracao.relacionados!(ctx, 'PRC-6060-CAL');
    expect(r.map((p) => p.sku)).toEqual(['ARG-AC3-20', 'REJ-EPX-1KG', 'ACS-NIV-KIT']);
  });

  it('devolve cópias: alterar o resultado não altera o catálogo', async () => {
    const p = (await conectorDemonstracao.obterProduto(ctx, 'PRC-6060-CAL'))!;
    p.preco = 1;
    expect((await conectorDemonstracao.obterProduto(ctx, 'PRC-6060-CAL'))!.preco).not.toBe(1);
  });
});
