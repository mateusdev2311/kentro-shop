import { criarClienteHttp } from '../../src/conectores/nucleo/cliente-http';
import { CtxConector } from '../../src/conectores/nucleo/conector';
import { RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { criarConectorNuvemshop, idioma, ufDe } from '../../src/conectores/nuvemshop/nuvemshop.conector';
import { APP_TESTE, ChamadaNuvemshop, criarFetchNuvemshop, NUVEMSHOP_CREDENCIAIS } from './fixtures-nuvemshop';

const conector = criarConectorNuvemshop(APP_TESTE);
let seq = 0;

function ctx(chamadas: ChamadaNuvemshop[] = [], credenciais: Record<string, string> = NUVEMSHOP_CREDENCIAIS): CtxConector {
  seq += 1;
  return {
    lojaId: `nuvem-${seq}`,
    credenciais,
    http: criarClienteHttp({
      lojaId: `nuvem-${seq}`,
      plataforma: 'nuvemshop',
      ritmo: { porSegundo: 1000, rajada: 1000 },
      fetch: criarFetchNuvemshop(chamadas),
      esperar: async () => undefined,
      registrar: async () => undefined,
    }),
    salvarCredenciais: async () => undefined,
  };
}

describe('conector Nuvemshop', () => {
  it('OAuth: nada a digitar; o link de autorização leva o app e o state', () => {
    expect(conector.camposDeCredencial).toEqual([]);
    expect(conector.capacidades.oauth).toBe(true);
    expect(conector.urlDeAutorizacao!('abc.def')).toBe('https://www.nuvemshop.com.br/apps/47447/authorize?state=abc.def');
  });

  it('troca o código pelo token e o store_id (com o client secret do app)', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    const credenciais = await conector.concluirAutorizacao!(ctx(chamadas, {}), { code: 'codigo-certo', state: 'x' });
    expect(credenciais).toEqual({ access_token: 'tok-certo', store_id: '123', escopo: 'read_products' });
    expect(chamadas[0].corpo).toEqual({ client_id: '47447', client_secret: 'segredo-do-app', grant_type: 'authorization_code', code: 'codigo-certo' });
    expect(conector.idExterno!(credenciais)).toBe('123');
  });

  it('código vencido (200 com "error") vira recusa, nunca credencial vazia', async () => {
    await expect(conector.concluirAutorizacao!(ctx([], {}), { code: 'velho' })).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
    await expect(conector.concluirAutorizacao!(ctx([], {}), {})).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
  });

  it('toda chamada leva Authorization Bearer e o User-Agent com contato', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    expect(await conector.testarConexao(ctx(chamadas))).toEqual({ ok: true, nomeLoja: 'Loja Nuvem Teste' });
    expect(chamadas[0].url).toBe('https://api.nuvemshop.com.br/2025-03/123/store?fields=name');
    expect(chamadas[0].cabecalhos).toMatchObject({ Authorization: 'Bearer tok-certo', 'User-Agent': 'Kentro Shop (https://shop.teste)' });
  });

  it('token revogado (app desinstalado): o teste explica que é preciso conectar de novo', async () => {
    const r = await conector.testarConexao(ctx([], { access_token: 'revogado', store_id: '123' }));
    expect(r).toEqual({ ok: false, mensagem: 'A Nuvemshop recusou o acesso. Conecte a loja de novo em Kentro Shop > Integração.' });
  });

  it('produto simples: nome em português, promoção, descrição sem HTML e estoque controlado', async () => {
    const p = (await conector.obterProduto(ctx(), '101'))!;
    expect(p).toMatchObject({
      id: '101',
      sku: 'PRC-CAL',
      nome: 'Porcelanato Calacata 60x60',
      descricao: 'Caixa com 1,44 m²',
      preco: 119.9,
      precoDe: 129.9,
      estoque: 10,
      disponivel: true,
      categoriaIds: ['11'],
      imagens: ['https://d26lpennugtm8s.cloudfront.net/calacata.jpg'],
      urlNaLoja: 'https://loja-teste.lojavirtualnuvem.com.br/produtos/calacata/',
      variacoes: [],
    });
  });

  it('estoque infinito (stock_management falso) fica null e disponível; promoção 0 é ignorada', async () => {
    const p = (await conector.obterProduto(ctx(), '103'))!;
    expect(p).toMatchObject({ preco: 39.9, estoque: null, disponivel: true });
    expect(p.precoDe).toBeUndefined();
  });

  it('variações: nome pelos valores, atributos, foto da variação e sem estoque indisponível', async () => {
    const p = (await conector.obterProduto(ctx(), '102'))!;
    expect(p.nome).toBe('Pintura Acrílica');
    expect(p.atributosVariacao).toEqual(['Cor']);
    expect(p.preco).toBe(80); // o menor entre as variações à venda
    expect(p.variacoes).toEqual([
      { id: '1002', sku: 'TNT-BR', nome: 'Branco', atributos: { Cor: 'Branco' }, preco: 80, estoque: 5, disponivel: true, imagem: 'https://d26lpennugtm8s.cloudfront.net/tinta.jpg' },
      { id: '1003', sku: 'TNT-PR', nome: 'Preto', atributos: { Cor: 'Preto' }, preco: 90, estoque: 0, disponivel: false },
    ]);
  });

  it('acha pelo SKU de uma variante; despublicado e inexistente devolvem null', async () => {
    expect((await conector.obterProduto(ctx(), 'TNT-PR'))!.id).toBe('102');
    expect(await conector.obterProduto(ctx(), '104')).toBeNull();
    expect(await conector.obterProduto(ctx(), 'NAO-EXISTE')).toBeNull();
  });

  it('lista só publicados, com busca e categoria; categorias com o nome em português', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    const c = ctx(chamadas);
    const todos = await conector.listarProdutos(c, { pagina: 1, porPagina: 24 });
    expect(todos.itens.map((p) => p.id)).toEqual(['101', '102', '103']);
    expect(todos.total).toBe(3);
    expect(new URL(chamadas[0].url).searchParams.get('published')).toBe('true');
    expect((await conector.listarProdutos(c, { busca: 'calacata', pagina: 1, porPagina: 24 })).itens.map((p) => p.id)).toEqual(['101']);
    expect((await conector.listarProdutos(c, { categoriaId: '11', pagina: 1, porPagina: 24 })).itens.map((p) => p.id)).toEqual(['101', '103']);
    expect(await conector.listarCategorias(c)).toEqual([
      { id: '11', nome: 'Pisos' },
      { id: '12', nome: 'Tintas' },
    ]);
  });

  it('campo multilíngue: português, depois espanhol, depois o que houver', () => {
    expect(idioma({ es: 'Hola', pt: 'Olá' })).toBe('Olá');
    expect(idioma({ es: 'Hola' })).toBe('Hola');
    expect(idioma({ fr: 'Salut' })).toBe('Salut');
    expect(idioma('Texto')).toBe('Texto');
  });

  it('carrinho numa chamada só: vários ids em /products?ids=, despublicado fica de fora; SKU vai um a um', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    const mapa = await conector.obterProdutos!(ctx(chamadas), ['101', '102', '104', 'ARG']);
    expect([...mapa.keys()]).toEqual(['101', '102', 'ARG']);
    expect(chamadas).toHaveLength(2);
    expect(new URL(chamadas[0].url).searchParams.get('ids')).toBe('101,102,104');
    expect(conector.cacheSegundos).toBe(60);
  });

  it('ao conectar registra só os webhooks que faltam', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    await conector.aoConectar!(ctx(chamadas));
    const criados = chamadas.filter((c) => c.metodo === 'POST').map((c) => c.corpo);
    expect(criados).toEqual(
      ['product/created', 'product/updated', 'product/deleted'].map((event) => ({ event, url: 'https://shop.teste/v1/nuvemshop/webhooks' })),
    );
  });

  it('rascunho de pedido: variante do produto simples, frete calculado, CPF e link de pagamento em https', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    const pedido = await conector.criarPedido!(ctx(chamadas), {
      cliente: { nome: 'Ana Maria Souza', telefone: '(38) 98888-7777', email: 'ana@exemplo.com', documento: '123.456.789-09' },
      entrega: { tipo: 'entrega', endereco: { cep: '39400-000', estado: 'MG', cidade: 'Montes Claros', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: 'Casa 2' } },
      itens: [
        { produtoId: '101', sku: 'PRC-CAL', quantidade: 2, precoUnitario: 119.9 },
        { produtoId: '102', variacaoId: '1002', sku: 'TNT-BR', quantidade: 1, precoUnitario: 80 },
      ],
      frete: { titulo: 'Frete', valor: 25 },
      observacoes: 'Entregar sábado',
      referenciaExterna: 'sessao-1',
    });
    expect(pedido).toEqual({ idExterno: '9001', numero: '9001', url: 'https://loja-teste.lojavirtualnuvem.com.br/checkout/v3/9001/tk', status: 'aguardando_pagamento' });
    const envios = chamadas.filter((c) => c.url.endsWith('/draft_orders'));
    expect(envios).toHaveLength(2); // o objeto "shipping" foi recusado e foi de novo como lista
    expect(envios[1].corpo).toMatchObject({
      contact_name: 'Ana',
      contact_lastname: 'Maria Souza',
      contact_email: 'ana@exemplo.com',
      cpf_cnpj: '12345678909',
      payment_status: 'pending',
      products: [
        { variant_id: 1001, quantity: 2 },
        { variant_id: 1002, quantity: 1 },
      ],
      shipping: [{ cost: '25.00', shipping_address: [{ address: 'Rua A', number: '10', floor: 'Casa 2', locality: 'Centro', city: 'Montes Claros', province: 'MG', zipcode: '39400000' }] }],
    });
    expect((envios[1].corpo as { note: string }).note).toContain('Entregar sábado');
  });

  it('rascunho sem e-mail é recusado antes de chamar a Nuvemshop', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    const sem = conector.criarPedido!(ctx(chamadas), {
      cliente: { nome: 'Ana', telefone: '1' },
      entrega: { tipo: 'retirada' },
      itens: [{ produtoId: '101', sku: 'PRC-CAL', quantidade: 1, precoUnitario: 119.9 }],
      referenciaExterna: 's',
    });
    await expect(sem).rejects.toThrow('o cliente precisa informar o e-mail');
    expect(chamadas).toHaveLength(0);
  });

  it('histórico pelo e-mail (ou CPF): endereços com a UF e pedidos com produto e variante', async () => {
    const porEmail = await conector.historicoDoCliente!(ctx(), { telefone: '5538988887777', email: 'Ana@Exemplo.com' });
    expect(porEmail).toEqual({
      nome: 'Ana Souza',
      email: 'ana@exemplo.com',
      enderecos: [{ cep: '39400000', estado: 'MG', cidade: 'Montes Claros', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: 'Casa 2' }],
      pedidos: [
        {
          numero: '104',
          data: '2026-09-10T10:00:00-0300',
          total: 239.8,
          itens: [{ sku: 'PRC-CAL', nome: 'Porcelanato Calacata 60x60', quantidade: 2, produtoId: '101', variacaoId: '1001' }],
        },
      ],
    });
    expect((await conector.historicoDoCliente!(ctx(), { telefone: '1', documento: '123.456.789-09' }))?.nome).toBe('Ana Souza');
    expect(await conector.historicoDoCliente!(ctx(), { telefone: '5538988887777' })).toBeNull(); // só telefone: a Nuvemshop não busca
  });

  it('estado por extenso vira sigla', () => {
    expect(ufDe('São Paulo')).toBe('SP');
    expect(ufDe('mg')).toBe('MG');
    expect(ufDe('Distrito Federal')).toBe('DF');
    expect(ufDe('Buenos Aires')).toBe('');
  });

  it('sem token ou store_id gravado: recusa antes de chamar', async () => {
    const chamadas: ChamadaNuvemshop[] = [];
    await expect(conector.listarCategorias(ctx(chamadas, {}))).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
    expect(chamadas).toHaveLength(0);
  });
});
