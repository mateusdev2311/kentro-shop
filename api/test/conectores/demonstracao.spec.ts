import { conectorDemonstracao } from '../../src/conectores/demonstracao/demonstracao.conector';
import { NICHOS, svgDaImagem, svgDoBannerDemo } from '../../src/conectores/demonstracao/nichos';
import { CtxConector } from '../../src/conectores/nucleo/conector';

const ctx = (credenciais: Record<string, string> = { codigo: 'demo' }, urlPublica?: string): CtxConector => ({
  lojaId: 'demo',
  credenciais,
  http: { requisitar: () => Promise.reject(new Error('o conector de demonstração não faz HTTP')) },
  salvarCredenciais: async () => undefined,
  ...(urlPublica ? { urlPublica } : {}),
});

describe('conector Demonstração', () => {
  it('pede o código "demo" e oferece o ramo padrão entre os ramos de exemplo', () => {
    expect(conectorDemonstracao.camposDeCredencial).toEqual([
      expect.objectContaining({ chave: 'codigo', tipo: 'texto', obrigatorio: true, ajuda: 'Digite demo para usar os produtos de exemplo.' }),
      expect.objectContaining({ chave: 'nicho', tipo: 'select', obrigatorio: false }),
    ]);
    const opcoes = conectorDemonstracao.camposDeCredencial[1].opcoes!.map((o) => o.valor);
    expect(opcoes).toEqual(['revestimentos', 'farmacia', 'petshop', 'mercado']);
  });

  it('sem ramo, continua sendo a loja de revestimentos (lojas que já usavam a demo)', async () => {
    const r = await conectorDemonstracao.listarProdutos(ctx(), { busca: 'VINILICO', pagina: 1, porPagina: 24 });
    expect(r.itens.length).toBeGreaterThan(0);
    expect(r.itens.every((p) => /vin[ií]lico/i.test(`${p.nome} ${p.descricaoCurta}`))).toBe(true);
    expect(await conectorDemonstracao.testarConexao(ctx())).toEqual({ ok: true, nomeLoja: 'Casa Modelo Revestimentos (exemplo)' });
  });

  it('filtra por categoria e traz as regras de exemplo (selo e m² por caixa)', async () => {
    const r = await conectorDemonstracao.listarProdutos(ctx(), { categoriaId: '1', pagina: 1, porPagina: 24 });
    expect(r.itens.every((p) => p.categoriaIds.includes('1'))).toBe(true);
    const calacata = (await conectorDemonstracao.obterProduto(ctx(), 'PRC-6060-CAL'))!;
    expect(calacata.regras).toMatchObject({ m2PorUnidade: 1.44, compreJunto: ['ARG-AC3-20', 'REJ-EPX-1KG', 'ACS-NIV-KIT'] });
  });

  it('com o ramo farmácia, lista as categorias e os produtos da farmácia', async () => {
    const farmacia = ctx({ codigo: 'demo', nicho: 'farmacia' });
    const categorias = await conectorDemonstracao.listarCategorias(farmacia);
    expect(categorias.map((c) => c.nome)).toContain('Medicamentos');
    const r = await conectorDemonstracao.listarProdutos(farmacia, { busca: 'dipirona', pagina: 1, porPagina: 24 });
    expect(r.itens.map((p) => p.sku)).toEqual(['FAR-DIP-500']);
    expect((await conectorDemonstracao.listarProdutos(farmacia, { busca: 'porcelanato', pagina: 1, porPagina: 24 })).itens).toEqual([]);
    expect(await conectorDemonstracao.testarConexao(farmacia)).toEqual({ ok: true, nomeLoja: 'Drogaria Modelo (exemplo)' });
  });

  it('acha o produto de qualquer ramo pelo id (o carrinho de outro link continua valendo)', async () => {
    expect((await conectorDemonstracao.obterProduto(ctx(), 'PET-RAC-CAD'))?.nome).toMatch(/Ração Cães Adultos/);
    expect(await conectorDemonstracao.obterProduto(ctx(), 'NAO-EXISTE')).toBeNull();
  });

  it('cada produto tem imagem no endereço da API; a variação com cor tem a sua; o desenho não sai do conector', async () => {
    const p = (await conectorDemonstracao.obterProduto(ctx({ codigo: 'demo' }, 'https://shop.teste'), 'PET-BOL-BOR'))!;
    expect(p.imagens).toEqual(['https://shop.teste/demo/imagens/PET-BOL-BOR.svg']);
    expect(p.variacoes.map((v) => v.imagem)).toEqual([
      'https://shop.teste/demo/imagens/PET-BOL-BOR~PET-BOL-BOR-VRM.svg',
      'https://shop.teste/demo/imagens/PET-BOL-BOR~PET-BOL-BOR-AZL.svg',
      'https://shop.teste/demo/imagens/PET-BOL-BOR~PET-BOL-BOR-VRD.svg',
    ]);
    expect(p).not.toHaveProperty('visual');
  });

  it('relacionados vêm do compre junto de exemplo', async () => {
    const r = await conectorDemonstracao.relacionados!(ctx(), 'PRC-6060-CAL');
    expect(r.map((p) => p.sku)).toEqual(['ARG-AC3-20', 'REJ-EPX-1KG', 'ACS-NIV-KIT']);
  });

  it('devolve cópias: alterar o resultado não altera o catálogo', async () => {
    const p = (await conectorDemonstracao.obterProduto(ctx(), 'PRC-6060-CAL'))!;
    p.preco = 1;
    p.variacoes.push({ id: 'x', sku: 'x', nome: 'x', atributos: {}, preco: 1, estoque: 1, disponivel: true });
    const lido = (await conectorDemonstracao.obterProduto(ctx(), 'PRC-6060-CAL'))!;
    expect(lido.preco).not.toBe(1);
    expect(lido.variacoes).toHaveLength(0);
  });
});

describe('dados dos ramos de exemplo', () => {
  const todos = NICHOS.flatMap((n) => n.produtos.map((p) => ({ nicho: n, p })));

  it('SKUs e ids de categoria não se repetem entre os ramos', () => {
    const skus = todos.map(({ p }) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
    const categorias = NICHOS.flatMap((n) => n.categorias.map((c) => c.id));
    expect(new Set(categorias).size).toBe(categorias.length);
  });

  it.each(NICHOS.map((n) => [n.id, n]))('%s: categorias, compre junto, vitrine e banners apontam para o que existe', (_id, nicho) => {
    const skus = new Set(nicho.produtos.map((p) => p.sku));
    const categorias = new Set(nicho.categorias.map((c) => c.id));
    for (const p of nicho.produtos) {
      expect(p.categoriaIds.every((c) => categorias.has(c))).toBe(true);
      expect((p.regras?.compreJunto ?? []).every((s) => skus.has(s))).toBe(true);
    }
    expect(nicho.loja.vitrineProdutos.every((s) => skus.has(s))).toBe(true);
    for (const b of nicho.banners) {
      expect(b.skus.every((s) => skus.has(s))).toBe(true);
      if (b.categoriaId) expect(categorias.has(b.categoriaId)).toBe(true);
    }
  });

  it('toda imagem de produto, de variação com cor e de banner é um SVG', () => {
    for (const { p } of todos) {
      expect(svgDaImagem(`${p.sku}.svg`)).toMatch(/^<svg [^>]*viewBox="0 0 800 800"/);
      for (const v of p.variacoes.filter((x) => x.cores?.length)) expect(svgDaImagem(`${p.sku}~${v.id}.svg`)).toMatch(/^<svg /);
    }
    for (const n of NICHOS) n.banners.forEach((_, i) => expect(svgDoBannerDemo(`${n.id}-${i + 1}.svg`)).toMatch(/^<svg [^>]*viewBox="0 0 1200 600"/));
  });

  it('o rótulo sai no SVG, sem script', () => {
    expect(svgDaImagem('MER-AGU-15.svg')).toContain('Sem gás · 1,5 L');
    expect(svgDaImagem('FAR-DIP-500.svg')).not.toMatch(/<script/i);
  });

  it('arquivo desconhecido ou fora do formato não vira imagem', () => {
    expect(svgDaImagem('NAO-EXISTE.svg')).toBeNull();
    expect(svgDaImagem('FAR-DIP-500.png')).toBeNull();
    expect(svgDaImagem('../FAR-DIP-500.svg')).toBeNull();
    expect(svgDaImagem('FAR-PSF-50~FAR-PSF-50-30.svg')).toBeNull(); // variação sem cor não tem imagem própria
    expect(svgDoBannerDemo('farmacia-9.svg')).toBeNull();
  });
});
