import { criarClienteHttp } from '../../src/conectores/nucleo/cliente-http';
import { CtxConector } from '../../src/conectores/nucleo/conector';
import { RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { conectorShopify, normalizarDominio } from '../../src/conectores/shopify/shopify.conector';
import { ChamadaShopify, criarFetchShopify, OpcoesShopifyFalsa, SHOPIFY_COM_ADMIN, SHOPIFY_CREDENCIAIS } from './fixtures-shopify';

let seq = 0;

function ctx(credenciais: Record<string, string> = SHOPIFY_CREDENCIAIS, opcoes: OpcoesShopifyFalsa = {}): CtxConector {
  seq += 1;
  return {
    lojaId: `shp-${seq}`,
    credenciais,
    http: criarClienteHttp({
      lojaId: `shp-${seq}`,
      plataforma: 'shopify',
      ritmo: { porSegundo: 1000, rajada: 1000 },
      fetch: criarFetchShopify(opcoes),
      esperar: async () => undefined,
      registrar: async () => undefined,
    }),
    salvarCredenciais: async () => undefined,
  };
}

describe('conector Shopify', () => {
  it('declara domínio, token Storefront (obrigatório) e token Admin (opcional), tokens como segredo', () => {
    expect(conectorShopify.camposDeCredencial.map((c) => [c.chave, c.tipo, c.obrigatorio])).toEqual([
      ['dominio', 'texto', true],
      ['token_storefront', 'segredo', true],
      ['token_admin', 'segredo', false],
    ]);
  });

  it('aceita o domínio de vários jeitos, mas só *.myshopify.com', () => {
    expect(normalizarDominio('minha-loja')).toBe('minha-loja.myshopify.com');
    expect(normalizarDominio(' https://Minha-Loja.myshopify.com/admin ')).toBe('minha-loja.myshopify.com');
    expect(normalizarDominio('minha-loja.myshopify.com')).toBe('minha-loja.myshopify.com');
    expect(() => normalizarDominio('www.minhaloja.com.br')).toThrow(RecusadoPelaPlataforma);
    expect(() => normalizarDominio('evil.com/x.myshopify.com')).toThrow(RecusadoPelaPlataforma);
    expect(() => normalizarDominio('')).toThrow(RecusadoPelaPlataforma);
  });

  it('chama a Storefront API com o token no cabeçalho e o nome da operação', async () => {
    const chamadas: ChamadaShopify[] = [];
    await conectorShopify.listarProdutos(ctx(SHOPIFY_CREDENCIAIS, { chamadas }), { pagina: 1, porPagina: 24 });
    expect(chamadas[0].url).toBe('https://loja-teste.myshopify.com/api/2026-10/graphql.json');
    expect(chamadas[0].cabecalhos['X-Shopify-Storefront-Access-Token']).toBe('sf-certo');
    expect(chamadas[0].operacao).toBe('Produtos');
  });

  it('produto simples: preço "de/por", estoque, imagem https, coleções como categorias', async () => {
    const p = await conectorShopify.obterProduto(ctx(), 'porcelanato-calacata');
    expect(p).toMatchObject({
      id: 'porcelanato-calacata',
      sku: 'PRC-CAL',
      nome: 'Porcelanato Calacata 60x60',
      preco: 119.9,
      precoDe: 129.9,
      estoque: 10,
      disponivel: true,
      unidade: 'UN',
      categoriaIds: ['1'],
      variacoes: [],
      imagens: ['https://cdn.shopify.com/s/files/calacata.jpg'],
      urlNaLoja: 'https://loja-teste.myshopify.com/products/porcelanato-calacata',
    });
    const arg = await conectorShopify.obterProduto(ctx(), 'argamassa-ac3');
    expect(arg!.imagens).toEqual(['https://inseguro.exemplo/arg.jpg']); // http vira https, como nos outros conectores
    expect(arg!.estoque).toBeNull(); // a loja não controla estoque
  });

  it('produto com variações: "a partir de" pelas vendáveis, variação esgotada indisponível', async () => {
    const p = await conectorShopify.obterProduto(ctx(), 'tinta-acrilica');
    expect(p).toMatchObject({ sku: 'tinta-acrilica', preco: 80, atributosVariacao: ['Cor'] });
    expect(p!.variacoes).toEqual([
      expect.objectContaining({ id: '1002', sku: 'TNT-BR', nome: 'Branco', atributos: { Cor: 'Branco' }, preco: 80, estoque: 5, disponivel: true }),
      expect.objectContaining({ id: '1003', sku: 'TNT-PR', nome: 'Preto', preco: 90, estoque: 0, disponivel: false }),
    ]);
  });

  it('sem o escopo de estoque no token, repete sem o estoque (estoque = null)', async () => {
    const chamadas: ChamadaShopify[] = [];
    const p = await conectorShopify.obterProduto(ctx(SHOPIFY_CREDENCIAIS, { chamadas, semEscopoDeEstoque: true }), 'porcelanato-calacata');
    expect(p!.estoque).toBeNull();
    expect(p!.disponivel).toBe(true);
    expect(chamadas).toHaveLength(2);
  });

  it('obtém pelo id numérico do produto e, com a Admin API, pelo SKU', async () => {
    expect((await conectorShopify.obterProduto(ctx(), '102'))!.id).toBe('tinta-acrilica');
    expect(await conectorShopify.obterProduto(ctx(), 'TNT-BR')).toBeNull(); // sem Admin API não há busca por SKU
    expect((await conectorShopify.obterProduto(ctx(SHOPIFY_COM_ADMIN), 'TNT-BR'))!.id).toBe('tinta-acrilica');
  });

  it('filtra por coleção e por busca', async () => {
    const pisos = await conectorShopify.listarProdutos(ctx(), { categoriaId: '1', pagina: 1, porPagina: 24 });
    expect(pisos.itens.map((p) => p.id)).toEqual(['porcelanato-calacata', 'argamassa-ac3']);
    const busca = await conectorShopify.listarProdutos(ctx(), { busca: 'tinta', pagina: 1, porPagina: 24 });
    expect(busca.itens.map((p) => p.id)).toEqual(['tinta-acrilica']);
    const inexistente = await conectorShopify.listarProdutos(ctx(), { categoriaId: '99', pagina: 1, porPagina: 24 });
    expect(inexistente).toMatchObject({ itens: [], temMais: false });
  });

  it('busca não deixa o texto mudar a sintaxe da consulta', async () => {
    const chamadas: ChamadaShopify[] = [];
    await conectorShopify.listarProdutos(ctx(SHOPIFY_CREDENCIAIS, { chamadas }), { busca: 'tinta" OR vendor:(x)', pagina: 1, porPagina: 24 });
    expect(chamadas[0].variaveis.q).toBe('tinta OR vendorx');
  });

  it('testar conexão: nome da loja; com token Admin inválido avisa qual token falhou', async () => {
    expect(await conectorShopify.testarConexao(ctx())).toEqual({ ok: true, nomeLoja: 'Loja Teste' });
    expect(await conectorShopify.testarConexao(ctx(SHOPIFY_COM_ADMIN))).toEqual({ ok: true, nomeLoja: 'Loja Teste' });
    expect(await conectorShopify.testarConexao(ctx({ ...SHOPIFY_COM_ADMIN, token_admin: 'errado' }))).toEqual({
      ok: false,
      mensagem: 'O token da Admin API foi recusado. Confira o token ou deixe o campo vazio para usar só o catálogo.',
    });
  });

  it('histórico do cliente pelo telefone (Admin API); sem token Admin devolve null', async () => {
    expect(await conectorShopify.historicoDoCliente!(ctx(), { telefone: '5538988887777' })).toBeNull();
    const h = await conectorShopify.historicoDoCliente!(ctx(SHOPIFY_COM_ADMIN), { telefone: '(38) 98888-7777' });
    expect(h).toEqual({
      nome: 'Ana Souza',
      email: 'ana@x.com',
      enderecos: [{ cep: '39400-000', estado: 'MG', cidade: 'Montes Claros', bairro: '', rua: 'Rua A, 10', numero: '', complemento: 'Centro' }],
      pedidos: [{ numero: '#1001', data: '2026-09-01T12:00:00Z', total: 239.8, itens: [{ sku: 'PRC-CAL', nome: 'Porcelanato Calacata 60x60', quantidade: 2 }] }],
    });
    expect(await conectorShopify.historicoDoCliente!(ctx(SHOPIFY_COM_ADMIN), { telefone: '5511900000000' })).toBeNull();
  });

  it('relacionados pelas recomendações da Shopify, sem o próprio produto', async () => {
    const r = await conectorShopify.relacionados!(ctx(), 'porcelanato-calacata');
    expect(r.map((p) => p.id)).toEqual(['tinta-acrilica', 'argamassa-ac3']);
    expect(await conectorShopify.relacionados!(ctx(), 'nao-existe')).toEqual([]);
  });

  it('erro GraphQL (200 com errors) vira recusa da plataforma', async () => {
    const fetchComErro = (async () => new Response(JSON.stringify({ errors: [{ message: 'Field x does not exist' }] }), { status: 200 })) as typeof fetch;
    const c = ctx();
    c.http = criarClienteHttp({ lojaId: 'x', plataforma: 'shopify', ritmo: { porSegundo: 1000, rajada: 1000 }, fetch: fetchComErro, esperar: async () => undefined, registrar: async () => undefined });
    await expect(conectorShopify.listarCategorias(c)).rejects.toThrow('Field x does not exist');
  });
});
