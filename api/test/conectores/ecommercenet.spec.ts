import { criarClienteHttp } from '../../src/conectores/nucleo/cliente-http';
import { CtxConector } from '../../src/conectores/nucleo/conector';
import { RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { conectorEcommercenet } from '../../src/conectores/ecommercenet/ecommercenet.conector';
import { ChamadaEcn, criarFetchEcn, ECN_AUTORIZACAO, ECN_CREDENCIAIS } from './fixtures-ecommercenet';

let seq = 0;

function ctx(fetchUsado: typeof fetch): CtxConector {
  seq += 1;
  return {
    lojaId: `ecn-${seq}`,
    credenciais: ECN_CREDENCIAIS,
    http: criarClienteHttp({
      lojaId: `ecn-${seq}`,
      plataforma: 'ecommercenet',
      ritmo: { porSegundo: 1000, rajada: 1000 },
      fetch: fetchUsado,
      esperar: async () => undefined,
      registrar: async () => undefined,
    }),
    salvarCredenciais: async () => undefined,
  };
}

describe('conector eCommerce-net', () => {
  it('declara os 3 campos de credencial, com o secret como segredo', () => {
    expect(conectorEcommercenet.camposDeCredencial.map((c) => [c.chave, c.tipo, c.obrigatorio])).toEqual([
      ['url_api', 'url', true],
      ['client_id', 'texto', true],
      ['client_secret', 'segredo', true],
    ]);
  });

  it('autentica com base64(client_id:client_secret) e monta a URL sem barra dupla', async () => {
    const chamadas: ChamadaEcn[] = [];
    await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn(chamadas)), { pagina: 1, porPagina: 24 });
    expect(chamadas[0].autorizacao).toBe(ECN_AUTORIZACAO);
    expect(chamadas[0].caminho).toBe('/product/all');
  });

  it('promoção "0.00", vazia ou nula não é promoção', async () => {
    const pagina = await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn()), { pagina: 1, porPagina: 2 });
    const comPromo = pagina.itens.find((p) => p.sku === 'PRC-6060-CAL')!;
    expect(comPromo).toMatchObject({ preco: 119.9, precoDe: 129.9 });
    const semPromo = pagina.itens.find((p) => p.sku === 'VNL-CARV')!;
    expect(semPromo.preco).toBe(189.9);
    expect(semPromo.precoDe).toBeUndefined();
    const p2 = await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn()), { pagina: 2, porPagina: 2 });
    expect(p2.itens[0]).toMatchObject({ preco: 54.9, estoque: 0, disponivel: false, unidade: 'SC', imagens: [] });
  });

  it('normaliza imagem para https e descrição para texto puro', async () => {
    const p = await conectorEcommercenet.obterProduto(ctx(criarFetchEcn()), 'PRC-6060-CAL');
    expect(p!.imagens).toEqual(['https://lojateste.ecommercenet.com.br/uploads/lojateste/produtos_imagens/calacata.jpg']);
    expect(p!.descricao).toBe('Porcelanato esmaltado polido.');
    expect(p!.unidade).toBe('CX');
    const lista = await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn()), { pagina: 1, porPagina: 2 });
    expect(lista.itens.find((x) => x.sku === 'VNL-CARV')!.imagens[0]).toMatch(/^https:\/\//);
  });

  it('estoque não informado vira null e o produto continua disponível', async () => {
    const lista = await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn()), { pagina: 1, porPagina: 2 });
    expect(lista.itens.find((x) => x.sku === 'VNL-CARV')).toMatchObject({ estoque: null, disponivel: true, unidade: 'UN' });
  });

  it('variações trazem preço, promoção e disponibilidade', async () => {
    const p = await conectorEcommercenet.obterProduto(ctx(criarFetchEcn()), 'VNL-CARV');
    expect(p!.atributosVariacao).toEqual(['Tom']);
    expect(p!.variacoes).toEqual([
      expect.objectContaining({ sku: 'VNL-CARV-NAT', nome: 'Natural', atributos: { Tom: 'Natural' }, preco: 169.9, precoDe: 189.9, estoque: 12, disponivel: true }),
      expect.objectContaining({ sku: 'VNL-CARV-ESC', preco: 189.9, estoque: 0, disponivel: false }),
    ]);
  });

  it('relacionados juntam compre junto e relacionados, sem repetir SKU', async () => {
    const r = await conectorEcommercenet.relacionados!(ctx(criarFetchEcn()), 'PRC-6060-CAL');
    expect(r.map((p) => p.sku)).toEqual(['ARG-AC3-20', 'REJ-EPX-CZ']);
  });

  it('success:false com status 200 é erro da plataforma, não lista vazia', async () => {
    const fetchRecusa = criarFetchEcn([], { 'produtos-p1': { status: 200, corpo: { success: false, errors: ['Loja suspensa'] } } });
    await expect(conectorEcommercenet.listarProdutos(ctx(fetchRecusa), { pagina: 1, porPagina: 2 })).rejects.toEqual(
      new RecusadoPelaPlataforma('Loja suspensa'),
    );
  });

  it('limita a página a 200 itens e repassa busca e categoria', async () => {
    const chamadas: ChamadaEcn[] = [];
    await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn(chamadas)), { pagina: 3, porPagina: 500, categoriaId: '7' });
    expect(chamadas[0].query.get('limit')).toBe('200');
    expect(chamadas[0].query.get('page')).toBe('3');
    expect(chamadas[0].query.get('category_id')).toBe('7');
  });

  it('resposta 200 que não é da API (ex.: o site da loja) é erro, não "conexão funcionando"', async () => {
    const site = criarFetchEcn([], { 'produtos-p1': { status: 200, corpo: '<!doctype html><title>Minha Loja</title>' } });
    const erro = new RecusadoPelaPlataforma('O endereço não respondeu como a API da eCommerce-net. Confira o Endereço da API.');
    await expect(conectorEcommercenet.testarConexao(ctx(site))).rejects.toEqual(erro);
    await expect(conectorEcommercenet.listarProdutos(ctx(site), { pagina: 1, porPagina: 2 })).rejects.toEqual(erro);
  });

  it('SKU inexistente (400 "Product not found") devolve null', async () => {
    expect(await conectorEcommercenet.obterProduto(ctx(criarFetchEcn()), 'NAO-EXISTE')).toBeNull();
  });

  it('rota de variações recusando o produto (400/404) deixa o produto sem variações', async () => {
    for (const status of [400, 404]) {
      const recusa = criarFetchEcn([], { variacoes: { status, corpo: { success: false, errors: ['This product is not a variety'], data: [] } } });
      const p = await conectorEcommercenet.obterProduto(ctx(recusa), 'VNL-CARV');
      expect(p!.variacoes).toEqual([]);
    }
  });

  it('produto sem preço não fica disponível', async () => {
    const semPreco = criarFetchEcn([], {
      'produto-simples': {
        status: 200,
        corpo: { success: true, data: { sku: 'PRC-6060-CAL', name: 'X', price: '', promotional_price: '', stock: '5', status: 1 } },
      },
    });
    expect(await conectorEcommercenet.obterProduto(ctx(semPreco), 'PRC-6060-CAL')).toMatchObject({ preco: 0, disponivel: false });
  });

  it('lista só produtos ativos na plataforma', async () => {
    const chamadas: ChamadaEcn[] = [];
    await conectorEcommercenet.listarProdutos(ctx(criarFetchEcn(chamadas)), { pagina: 1, porPagina: 24 });
    expect(chamadas[0].query.get('status')).toBe('1');
  });

  it('testar conexão faz uma chamada mínima', async () => {
    const chamadas: ChamadaEcn[] = [];
    expect(await conectorEcommercenet.testarConexao(ctx(criarFetchEcn(chamadas)))).toEqual({ ok: true });
    expect(chamadas[0].query.get('limit')).toBe('1');
  });
});
