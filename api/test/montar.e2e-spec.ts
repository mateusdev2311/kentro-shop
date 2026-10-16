import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

describe('link montado pelo atendente (carrinho pronto e filtro)', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let ipSeq = 0;
  let ip = '';
  const http = () => request(app.getHttpServer());
  const criar = (corpo: object, chave = loja.chaveAtendimento) =>
    http().post('/v1/sessoes').set('X-Loja-Chave', chave).send({ chatId: '100', nome: 'Ana', telefone: '5538988887777', ...corpo });
  const tokenDe = (url: string) => url.split('/c/')[1];
  const pub = (metodo: 'get' | 'put', url: string) => http()[metodo](url).set('X-Forwarded-For', ip);

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.130.0.${ipSeq}`;
    reiniciarFalso();
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('carrinho pronto: itens revalidados, autor atendente, link ainda não aberto', async () => {
    const res = await criar({ itens: [{ produtoId: 'id-A1', quantidade: 2 }, { produtoId: 'id-ZZ', quantidade: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('link_enviado');
    expect(res.body.itens).toEqual([expect.objectContaining({ produtoId: 'id-A1', precoUnitario: 129.9, quantidade: 2 })]);
    expect(res.body.avisos).toEqual(['Um produto do carrinho não está mais disponível.']);
    expect(res.body.eventos[0]).toMatchObject({ texto: 'Atendente — Adicionou 2 unidades de Produto A1', autor: 'atendente' });
  });

  it('link com filtro ou carrinho pronto cria outro link e encerra o anterior aberto', async () => {
    const primeiro = await criar({});
    const segundo = await criar({ filtro: { categoriaId: '2' } });
    expect(segundo.status).toBe(201);
    expect(segundo.body.url).not.toBe(primeiro.body.url);
    expect(segundo.body).toMatchObject({ filtro: { categoriaId: '2' }, restrito: true });
    expect((await pub('get', `/v1/catalogo/${tokenDe(primeiro.body.url)}/abrir`)).status).toBe(404);
    // Sem filtro, itens ou opções: reaproveita o aberto (comportamento de antes).
    const terceiro = await criar({});
    expect(terceiro.status).toBe(200);
    expect(terceiro.body.url).toBe(segundo.body.url);
  });

  it('filtro inválido → 400', async () => {
    expect((await criar({ filtro: { produtoIds: Array.from({ length: 51 }, (_, i) => `p${i}`) } })).status).toBe(400);
    expect((await criar({ filtro: { categoriaId: 'x'.repeat(51) } })).status).toBe(400);
    expect((await criar({ itens: [{ produtoId: 'id-A1', quantidade: -1 }] })).status).toBe(400);
  });

  it('seleção de produtos restrita: o cliente vê e compra só o que foi separado', async () => {
    const res = await criar({ filtro: { produtoIds: ['id-C3', 'id-A1'] } });
    const token = tokenDe(res.body.url);
    const aberto = await pub('get', `/v1/catalogo/${token}/abrir`);
    expect(aberto.body).toMatchObject({ filtro: { produtoIds: ['id-C3', 'id-A1'] }, restrito: true });
    const lista = await pub('get', `/v1/catalogo/${token}/produtos?categoria=2`);
    expect(lista.body.itens.map((p: { id: string }) => p.id)).toEqual(['id-C3', 'id-A1']);
    expect(lista.body.temMais).toBe(false);
    expect((await pub('get', `/v1/catalogo/${token}/produtos?busca=A1`)).body.itens.map((p: { id: string }) => p.id)).toEqual(['id-A1']);
    expect((await pub('get', `/v1/catalogo/${token}/categorias`)).body).toEqual([]);
    expect((await pub('get', `/v1/catalogo/${token}/produtos/id-B2`)).status).toBe(404);
    const carrinho = await pub('put', `/v1/catalogo/${token}/carrinho`).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }, { produtoId: 'id-B2', quantidade: 1 }] });
    expect(carrinho.body.sessao.itens.map((i: { produtoId: string }) => i.produtoId)).toEqual(['id-A1']);
    expect(carrinho.body.avisos).toEqual(['Produto B2 não faz parte desta seleção.']);
  });

  it('categoria restrita: lista e categorias presas à categoria do link', async () => {
    const token = tokenDe((await criar({ filtro: { categoriaId: '2' } })).body.url);
    const lista = await pub('get', `/v1/catalogo/${token}/produtos?categoria=1`);
    expect(lista.body.itens.map((p: { id: string }) => p.id)).toEqual(['id-B2']);
    expect((await pub('get', `/v1/catalogo/${token}/categorias`)).body.map((c: { id: string }) => c.id)).toEqual(['2']);
  });

  it('filtro não restrito: é só a vitrine inicial (selecao=1); o catálogo todo continua aberto', async () => {
    const token = tokenDe((await criar({ filtro: { categoriaId: '2' }, restrito: false })).body.url);
    expect((await pub('get', `/v1/catalogo/${token}/produtos?selecao=1`)).body.itens.map((p: { id: string }) => p.id)).toEqual(['id-B2']);
    expect((await pub('get', `/v1/catalogo/${token}/produtos`)).body.itens.length).toBeGreaterThan(1);
    expect((await pub('get', `/v1/catalogo/${token}/categorias`)).body.length).toBeGreaterThan(1);
  });

  it('o atendente troca o carrinho de um link aberto; de outra loja ou finalizado não', async () => {
    const s = (await criar({})).body;
    const put = (id: string, chave = loja.chaveAtendimento) =>
      http().put(`/v1/sessoes/${id}/carrinho`).set('X-Loja-Chave', chave).send({ itens: [{ produtoId: 'id-B2', quantidade: 3 }] });
    const res = await put(s.id);
    expect(res.status).toBe(200);
    expect(res.body.sessao.itens).toEqual([expect.objectContaining({ produtoId: 'id-B2', quantidade: 3 })]);
    expect(res.body.sessao.status).toBe('link_enviado');
    const outra = await lojaIntegrada(app);
    expect((await put(s.id, outra.chaveAtendimento)).status).toBe(404);
    await prisma.sessao.update({ where: { id: s.id }, data: { status: 'finalizado' } });
    expect((await put(s.id)).status).toBe(409);
  });

  it('histórico do contato para o painel (pedidos e endereços), só da própria loja', async () => {
    await prisma.clienteLoja.create({
      data: {
        lojaId: loja.lojaId,
        telefone: '5538988887777',
        enderecos: [{ cep: '39400-000', rua: 'Rua A', numero: '10' }],
        pedidos: [{ data: '2026-09-01T00:00:00.000Z', total: 10, itens: [{ produtoId: 'id-A1', variacaoId: null, sku: 'A1', nome: 'Produto A1', variacaoNome: null, quantidade: 1 }] }],
      },
    });
    const h = await http().get('/v1/sessoes/historico?telefone=(38) 98888-7777').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(h.status).toBe(200);
    expect(h.body.pedidos).toHaveLength(1);
    expect(h.body.enderecos[0]).toMatchObject({ rua: 'Rua A' });
    const outra = await lojaIntegrada(app);
    expect((await http().get('/v1/sessoes/historico?telefone=5538988887777').set('X-Loja-Chave', outra.chaveAtendimento)).body).toEqual({ enderecos: [], pedidos: [] });
  });
});
