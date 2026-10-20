import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

describe('servidor MCP (/mcp) da assistente de IA', () => {
  let app: INestApplication;
  let loja: LojaDeTeste & { tokenMcp: string };
  let seq = 0;
  const http = () => request(app.getHttpServer());
  const rpc = (corpo: object, token = loja.tokenMcp) => http().post('/mcp').set('Authorization', `Bearer ${token}`).send(corpo);
  const chamar = async (name: string, args: object = {}, token = loja.tokenMcp) => {
    seq += 1;
    const res = await rpc({ jsonrpc: '2.0', id: seq, method: 'tools/call', params: { name, arguments: args } }, token);
    expect(res.status).toBe(200);
    return { texto: res.body.result.content[0].text as string, erro: res.body.result.isError as boolean };
  };

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    reiniciarFalso();
    await limparBanco(prisma);
    loja = (await lojaIntegrada(app)) as LojaDeTeste & { tokenMcp: string };
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('sem token ou com token errado → 401; GET → 405', async () => {
    expect((await http().post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    const errado = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'ksm_errado');
    expect(errado.status).toBe(401);
    expect(errado.headers['www-authenticate']).toBe('Bearer');
    // A chave de atendimento não vale como token MCP.
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, loja.chaveAtendimento)).status).toBe(401);
    expect((await http().get('/mcp').set('Authorization', `Bearer ${loja.tokenMcp}`)).status).toBe(405);
  });

  it('initialize, notificação (202), ping, tools/list e método desconhecido', async () => {
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(init.status).toBe(200);
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kentro-shop' } });
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'ping' })).body).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    const lista = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(lista.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'buscar_produtos',
      'detalhes_produto',
      'listar_categorias',
      'info_loja',
      'gerar_link_catalogo',
      'adicionar_ao_carrinho',
      'alterar_item_carrinho',
      'consultar_carrinho',
      'pedidos_anteriores',
    ]);
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' })).body.error.code).toBe(-32601);
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nao_existe' } })).body.error.code).toBe(-32602);
    const lote = await rpc([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }] as unknown as object);
    expect(lote.body).toEqual([{ jsonrpc: '2.0', id: 6, result: {} }]);
  });

  it('busca e ficha com preço, promoção, variações e estoque ao vivo', async () => {
    const busca = await chamar('buscar_produtos', {});
    expect(busca.erro).toBe(false);
    expect(busca.texto).toContain('produto_id id-A1 · SKU A1 · R$ 129,90 (de R$ 149,90) por unidade · estoque 5');
    expect(busca.texto).toContain('variacao_id v1 · Azul · R$ 20,00 · estoque 3');
    expect(busca.texto).toContain('variacao_id v2 · Verde · R$ 20,00 · esgotado');
    expect((await chamar('buscar_produtos', { busca: 'nada-disso' })).texto).toContain('Nenhum produto encontrado');
    const ficha = await chamar('detalhes_produto', { produto_id: 'id-A1' });
    expect(ficha.texto).toContain('Descrição A1');
    expect(ficha.texto).toContain('https://img.teste/A1.jpg');
    expect(await chamar('detalhes_produto', { produto_id: 'id-ZZ' })).toMatchObject({ erro: true });
    expect(await chamar('detalhes_produto', {})).toEqual({ texto: 'Informe produto_id.', erro: true });
    expect((await chamar('listar_categorias')).texto).toContain('categoria_id 2: Argamassas');
  });

  it('loja sem preço visível: a IA não recebe valores', async () => {
    await http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send({ mostrarPrecos: false });
    const busca = await chamar('buscar_produtos', {});
    expect(busca.texto).toContain('não mostra preços');
    expect(busca.texto).not.toContain('R$');
    expect((await chamar('info_loja')).texto).toContain('NÃO aparecem');
  });

  it('categoria oculta fica de fora da busca e das categorias', async () => {
    await http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send({ categoriasOcultas: ['2'] });
    expect((await chamar('buscar_produtos', {})).texto).not.toContain('id-B2');
    expect((await chamar('listar_categorias')).texto).not.toContain('Argamassas');
    expect((await chamar('buscar_produtos', { categoria_id: '2' })).texto).toContain('não está disponível');
  });

  it('link personalizado com carrinho pronto, registrado como da IA', async () => {
    const r = await chamar('gerar_link_catalogo', {
      chat_id: 321,
      nome: 'Ana',
      telefone: '5538988887777',
      produto_ids: ['id-A1', 'id-C3'],
      itens: [{ produto_id: 'id-A1', quantidade: 2 }, { produto_id: 'id-C3', variacao_id: 'v1', quantidade: 1 }, { produto_id: 'id-C3', quantidade: 1 }],
    });
    expect(r.erro).toBe(false);
    expect(r.texto).toContain('Link novo gerado.');
    expect(r.texto).toContain('Escolha a opção de Produto C3.');
    expect(r.texto).toContain('2 unidades de Produto A1 — R$ 259,80');
    expect(r.texto).toContain('1 unidade de Produto C3 (Azul) — R$ 20,00');
    expect(r.texto).toMatch(/Envie ao cliente exatamente este link: https:\/\/shop\.teste\/c\/\S+/);
    const sessao = await prisma.sessao.findFirstOrThrow({ where: { lojaId: loja.lojaId, chatId: '321' }, include: { eventos: true } });
    expect(sessao.filtro).toEqual({ produtoIds: ['id-A1', 'id-C3'] });
    expect(sessao.eventos.every((e) => e.autor === 'ia')).toBe(true);
    expect(sessao.eventos.map((e) => e.texto)).toContain('Assistente de IA — Adicionou 2 unidades de Produto A1');
  });

  it('não descarta o carrinho do link aberto sem pedir; adicionar e alterar mantêm o link', async () => {
    const primeiro = await chamar('gerar_link_catalogo', { chat_id: '50', itens: [{ produto_id: 'id-A1', quantidade: 1 }] });
    const url = /exatamente este link: (\S+)/.exec(primeiro.texto)![1];
    const recusado = await chamar('gerar_link_catalogo', { chat_id: '50', categoria_id: '2' });
    expect(recusado.erro).toBe(true);
    expect(recusado.texto).toContain('adicionar_ao_carrinho');
    // Sem personalização, é o mesmo link.
    expect((await chamar('gerar_link_catalogo', { chat_id: '50' })).texto).toContain(url);

    const somado = await chamar('adicionar_ao_carrinho', { chat_id: '50', itens: [{ produto_id: 'id-A1', quantidade: 2 }, { produto_id: 'id-B2', quantidade: 1 }] });
    expect(somado.texto).toContain('3 unidades de Produto A1');
    expect(somado.texto).toContain('1 unidade de Produto B2');
    expect(somado.texto).toContain(url);
    const estoque = await chamar('adicionar_ao_carrinho', { chat_id: '50', itens: [{ produto_id: 'id-A1', quantidade: 10 }] });
    expect(estoque.texto).toContain('Só temos 5 unidades de Produto A1.');

    const removido = await chamar('alterar_item_carrinho', { chat_id: '50', produto_id: 'id-B2', quantidade: 0 });
    expect(removido.texto).not.toContain('Produto B2');
    expect(removido.texto).toContain('5 unidades de Produto A1');
    expect(await chamar('alterar_item_carrinho', { chat_id: '50', produto_id: 'id-C3', quantidade: 1 })).toMatchObject({ erro: true });

    const consulta = await chamar('consultar_carrinho', { chat_id: '50' });
    expect(consulta.texto).toContain('link enviado, o cliente ainda não abriu');
    expect(consulta.texto).toContain('Últimas atividades:');

    const novo = await chamar('gerar_link_catalogo', { chat_id: '50', categoria_id: '2', substituir_link_aberto: true });
    expect(novo.erro).toBe(false);
    expect(novo.texto).not.toContain(url);
  });

  it('link finalizado não aceita mudança; sem link, consultar e adicionar explicam o que fazer', async () => {
    expect((await chamar('consultar_carrinho', { chat_id: '77' })).texto).toBe('Nenhum link de catálogo foi gerado neste atendimento.');
    expect((await chamar('adicionar_ao_carrinho', { chat_id: '77', itens: [{ produto_id: 'id-A1', quantidade: 1 }] })).texto).toContain('gerar_link_catalogo');
    await chamar('gerar_link_catalogo', { chat_id: '77', itens: [{ produto_id: 'id-A1', quantidade: 1 }] });
    await prisma.sessao.updateMany({ where: { chatId: '77' }, data: { status: 'finalizado' } });
    const r = await chamar('adicionar_ao_carrinho', { chat_id: '77', itens: [{ produto_id: 'id-A1', quantidade: 1 }] });
    expect(r).toMatchObject({ erro: true });
    expect(r.texto).toContain('FINALIZOU');
    expect((await chamar('consultar_carrinho', { chat_id: '77' })).texto).toContain('o cliente FINALIZOU o pedido');
    expect(await chamar('adicionar_ao_carrinho', { chat_id: '77', itens: [{ produto_id: 'id-A1', quantidade: 0 }] })).toMatchObject({ erro: true });
  });

  it('cada token só enxerga a própria loja', async () => {
    await chamar('gerar_link_catalogo', { chat_id: '900' });
    const outra = (await lojaIntegrada(app)) as LojaDeTeste & { tokenMcp: string };
    expect((await chamar('consultar_carrinho', { chat_id: '900' }, outra.tokenMcp)).texto).toBe('Nenhum link de catálogo foi gerado neste atendimento.');
  });

  it('pedidos anteriores pelo telefone, sem endereço', async () => {
    await prisma.clienteLoja.create({
      data: {
        lojaId: loja.lojaId,
        telefone: '5538988887777',
        enderecos: [{ cep: '39400-000', rua: 'Rua Secreta', numero: '10' }],
        pedidos: [{ data: '2026-09-01T12:00:00.000Z', total: 20, itens: [{ produtoId: 'id-C3', variacaoId: 'v1', sku: 'C3-AZ', nome: 'Produto C3', variacaoNome: 'Azul', quantidade: 1 }] }],
      },
    });
    const r = await chamar('pedidos_anteriores', { telefone: '(38) 98888-7777' });
    expect(r.texto).toContain('Pedido de 01/09/2026 — R$ 20,00');
    expect(r.texto).toContain('1x Produto C3 (Azul) [produto_id id-C3, variacao_id v1]');
    expect(r.texto).not.toContain('Rua Secreta');
  });

  it('o token MCP é rotacionado pela chave de admin', async () => {
    const res = await http().post('/v1/loja/token-mcp/rotacionar').set('X-Loja-Chave', loja.chaveAdmin);
    expect(res.status).toBe(200);
    expect(res.body.chave).toMatch(/^ksm_/);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, res.body.chave)).status).toBe(200);
  });
});
