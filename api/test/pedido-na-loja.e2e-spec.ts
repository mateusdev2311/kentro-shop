import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Conector } from '../src/conectores/nucleo/conector';
import { RecusadoPelaPlataforma } from '../src/conectores/nucleo/erros';
import { PedidoParaCriar } from '../src/contratos/modelo';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { conectorFalso, controleFalso, reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

const ENTREGA = {
  nome: 'Ana Souza',
  telefone: '(38) 98888-7777',
  cep: '39400000',
  estado: 'MG',
  cidade: 'Montes Claros',
  bairro: 'Centro',
  rua: 'Rua A',
  numero: '10',
  complemento: '',
  referencia: '',
};

/** Plataforma falsa que cria pedido (como o rascunho com link de pagamento da Nuvemshop). */
const pedidos: PedidoParaCriar[] = [];
const controlePedido = { falhar: false };
const comPedido: Conector = {
  ...conectorFalso,
  // Como a Nuvemshop: leituras em cache por 1 minuto.
  cacheSegundos: 60,
  capacidades: { ...conectorFalso.capacidades, criarPedido: true },
  async criarPedido(_ctx, pedido) {
    if (controlePedido.falhar) throw new RecusadoPelaPlataforma('Estoque reservado por outro pedido.');
    pedidos.push(pedido);
    return { idExterno: '9001', numero: '1042', url: 'https://loja.teste/checkout/9001', status: 'aguardando_pagamento' };
  },
};

describe('pedido criado na loja e itens adicionados pelo atendente', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let token: string;
  let ipSeq = 0;
  const http = () => request(app.getHttpServer());
  const cliente = () => {
    ipSeq += 1;
    return `10.120.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
  };
  const sessaoDoChat = async () => (await http().get('/v1/sessoes/chat/100').set('X-Loja-Chave', loja.chaveAtendimento)).body;
  const adicionar = (id: string, itens: object[]) => http().post(`/v1/sessoes/${id}/itens`).set('X-Loja-Chave', loja.chaveAtendimento).send({ itens });
  const finalizar = (corpo: object) => http().post(`/v1/catalogo/${token}/finalizar`).set('X-Forwarded-For', cliente()).send(corpo);
  const modo = (modoPedido: string) => http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send({ modoPedido });

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { conectores: [comPedido] });
  });
  beforeEach(async () => {
    reiniciarFalso();
    pedidos.length = 0;
    controlePedido.falhar = false;
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
    token = await gerarLink(app, loja);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('o atendente soma itens ao carrinho do link aberto: mesmo link, nada do cliente se perde', async () => {
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: 'id-B2', quantidade: 1 }] });
    const { id } = await sessaoDoChat();
    expect((await adicionar(id, [{ produtoId: 'id-A1', quantidade: 2 }])).status).toBe(200);
    const r = await adicionar(id, [{ produtoId: 'id-A1', quantidade: 1 }]);
    expect(r.body.avisos).toEqual([]);
    const itens = r.body.sessao.itens.map((i: { sku: string; quantidade: number }) => [i.sku, i.quantidade]);
    expect(itens).toEqual(expect.arrayContaining([['B2', 1], ['A1', 3]]));
    expect(r.body.sessao.url.endsWith(`/c/${token}`)).toBe(true); // mesmo link
    expect((await sessaoDoChat()).eventos[0].texto).toBe('Atendente — Alterou Produto A1: 2 → 3');
  });

  it('modo "criar pedido": o checkout pede o e-mail e o pedido vira rascunho na loja com o link de pagamento', async () => {
    expect((await modo('criar_pedido')).status).toBe(200);
    expect((await http().get(`/v1/catalogo/${token}/abrir`).set('X-Forwarded-For', cliente())).body.pedidoNaLoja).toBe(true);
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: 'id-A1', quantidade: 2 }] });

    const semEmail = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(semEmail.status).toBe(400);
    expect(semEmail.body.erro.mensagem).toBe('Informe o seu e-mail para receber o pedido.');

    const r = await finalizar({ tipo: 'entrega', entrega: ENTREGA, email: 'ana@exemplo.com' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('pedido_criado');
    expect(r.body.pedido).toEqual({ idExterno: '9001', numero: '1042', url: 'https://loja.teste/checkout/9001', status: 'aguardando_pagamento' });
    expect(pedidos[0]).toMatchObject({
      cliente: { nome: 'Ana Souza', email: 'ana@exemplo.com' },
      entrega: { tipo: 'entrega', endereco: { cep: '39400-000', rua: 'Rua A' } },
      itens: [{ produtoId: 'id-A1', sku: 'A1', quantidade: 2, precoUnitario: 129.9 }],
    });
    const painel = await sessaoDoChat();
    expect(painel.resumo).toContain('Pedido na loja: nº 1042');
    expect(painel.resumo).toContain('Link de pagamento: https://loja.teste/checkout/9001');
    expect(painel.eventos[0].texto).toBe('Pedido nº 1042 criado na Plataforma Falsa, com link de pagamento para o cliente');
  });

  it('a loja recusou o pedido: a finalização vale e o atendente fecha a venda', async () => {
    await modo('criar_pedido');
    controlePedido.falhar = true;
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }] });
    const r = await finalizar({ tipo: 'entrega', entrega: ENTREGA, email: 'ana@exemplo.com' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('finalizado');
    expect(r.body.pedido).toBeNull();
    expect((await sessaoDoChat()).eventos[0].texto).toBe('Não foi possível criar o pedido na loja (Estoque reservado por outro pedido.) O atendente fecha a venda.');
  });

  it('pedido de orçamento (link sem preço) segue para o atendente, sem pedir e-mail', async () => {
    await modo('criar_pedido');
    token = await gerarLink(app, loja, '100', { mostrarPrecos: false });
    expect((await http().get(`/v1/catalogo/${token}/abrir`).set('X-Forwarded-For', cliente())).body.pedidoNaLoja).toBe(false);
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }] });
    const r = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(r.body.status).toBe('finalizado');
    expect(pedidos).toHaveLength(0);
  });

  it('modo padrão (atendente): não cria pedido nem pede e-mail', async () => {
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }] });
    const r = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(r.body.status).toBe('finalizado');
    expect(pedidos).toHaveLength(0);
  });

  it('o atendente fecha o pedido pelo painel: cria na loja (com o e-mail) e o link do cliente vira a confirmação', async () => {
    await modo('criar_pedido');
    const { id } = await sessaoDoChat();
    await adicionar(id, [{ produtoId: 'id-A1', quantidade: 2 }]);
    const fechar = (corpo: object) =>
      http().post(`/v1/sessoes/${id}/finalizar`).set('X-Loja-Chave', loja.chaveAtendimento).set('X-Kentro-Usuario-Nome', 'Bruna').send({ tipo: 'entrega', entrega: ENTREGA, ...corpo });
    expect((await fechar({})).body.erro.mensagem).toBe('Informe o seu e-mail para receber o pedido.');
    const r = await fechar({ email: 'ana@exemplo.com' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'pedido_criado', pedido: { numero: '1042', url: 'https://loja.teste/checkout/9001' } });
    expect(r.body.pedido.acompanhar).toBeUndefined(); // a plataforma falsa não informa a situação
    expect(r.body.eventos.map((e: { texto: string }) => e.texto)).toContain('Bruna finalizou o pedido pelo painel (entrega) — R$ 259,80');
    expect(pedidos).toHaveLength(1);
    // O cliente que abrir o link vê o pedido feito, sem poder mexer.
    const carrinho = await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [] });
    expect(carrinho.body.erro.codigo).toBe('PEDIDO_JA_ENVIADO');
    expect((await http().post(`/v1/sessoes/${id}/pedido/atualizar`).set('X-Loja-Chave', loja.chaveAtendimento)).body.erro.codigo).toBe('SEM_ACOMPANHAMENTO');
  });

  it('o catálogo usa o cache, mas finalizar confere o preço de agora', async () => {
    const produto = () => http().get(`/v1/catalogo/${token}/produtos/id-A1`).set('X-Forwarded-For', cliente());
    expect((await produto()).body.preco).toBe(129.9);
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }] });
    controleFalso.precos.A1 = 139.9;
    expect((await produto()).body.preco).toBe(129.9); // ainda o do cache
    const r = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('PRECOS_ALTERADOS');
    expect(r.body.diferencas[0]).toMatchObject({ antes: { preco: 129.9 }, depois: { preco: 139.9 } });
  });
});
