import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

describe('chave de automação (URA da Kentro gera o link)', () => {
  let app: INestApplication;
  let loja: { lojaId: string; chaveAdmin: string; chaveAtendimento: string };
  const http = () => request(app.getHttpServer());
  const admin = (metodo: 'get' | 'post' | 'delete', caminho: string, chave = loja.chaveAdmin) => http()[metodo](caminho).set('X-Loja-Chave', chave);
  const link = (chave: string, corpo: object) => http().post('/v1/automacao/link').set('X-Loja-Chave', chave).send(corpo);
  const gerarChave = async () => (await admin('post', '/v1/loja/chave-automacao/rotacionar')).body.chave as string;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    ipSeq += 1;
    loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.9.0.${ipSeq}`).send({ nome: 'Loja URA' })).body;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('nasce desativada; o admin gera, vê ativa e desativa', async () => {
    expect((await admin('get', '/v1/loja/chave-automacao')).body).toEqual({ ativa: false });
    const chave = await gerarChave();
    expect(chave).toMatch(/^ksu_/);
    expect((await admin('get', '/v1/loja/chave-automacao')).body).toEqual({ ativa: true });
    const linha = JSON.stringify(await prisma.loja.findUniqueOrThrow({ where: { id: loja.lojaId } }));
    expect(linha).not.toContain(chave.slice(4));
    expect((await admin('delete', '/v1/loja/chave-automacao')).body).toEqual({ ativa: false });
    expect((await link(chave, { chatId: '1' })).status).toBe(401);
  });

  it('só o admin mexe na chave', async () => {
    expect((await admin('post', '/v1/loja/chave-automacao/rotacionar', loja.chaveAtendimento)).status).toBe(403);
    expect((await admin('get', '/v1/loja/chave-automacao', loja.chaveAtendimento)).status).toBe(403);
  });

  it('gera o link do atendimento com o chat_id em número e reaproveita na segunda chamada', async () => {
    const chave = await gerarChave();
    const a = await link(chave, { chatId: 4567, nome: 'Ana', telefone: 5538988887777 });
    expect(a.status).toBe(200);
    expect(a.body.url).toMatch(/^https:\/\/shop\.teste\/c\/[A-Za-z0-9_-]{32}$/);
    expect(a.body.novo).toBe(true);
    const b = await link(chave, { chatId: '4567', nome: '', telefone: '' });
    expect(b.body).toMatchObject({ url: a.body.url, novo: false });

    // É o mesmo atendimento que o painel enxerga, com o contato e a atividade da URA.
    const painel = await http().get('/v1/sessoes/chat/4567').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(painel.body.url).toBe(a.body.url);
    expect(painel.body.cliente).toEqual({ nome: 'Ana', telefone: '5538988887777' });
    expect(painel.body.eventos.map((e: { texto: string }) => e.texto)).toEqual(['Link do catálogo gerado pela URA da Kentro']);
  });

  it('com categoria, o link abre nela e é novo, no mesmo carrinho', async () => {
    const chave = await gerarChave();
    const a = await link(chave, { chatId: '9' });
    const b = await link(chave, { chatId: '9', categoriaId: 'cat-1' });
    expect(b.body.novo).toBe(true);
    expect(b.body.url).not.toBe(a.body.url);
    expect(b.body.sessaoId).toBe(a.body.sessaoId);
    const sessao = await prisma.sessao.findUniqueOrThrow({ where: { id: b.body.sessaoId } });
    expect(sessao.filtro).toEqual({ categoriaId: 'cat-1' });
  });

  it('a chave de automação não abre o painel nem o admin, e as outras chaves não abrem a automação', async () => {
    const chave = await gerarChave();
    expect((await http().get('/v1/loja').set('X-Loja-Chave', chave)).status).toBe(401);
    expect((await http().post('/v1/sessoes').set('X-Loja-Chave', chave).send({ chatId: '1' })).status).toBe(401);
    expect((await link(loja.chaveAtendimento, { chatId: '1' })).status).toBe(401);
    expect((await link(loja.chaveAdmin, { chatId: '1' })).status).toBe(401);
    expect((await http().post('/v1/automacao/link').send({ chatId: '1' })).status).toBe(401);
  });

  it('gerar de novo derruba a chave anterior; loja bloqueada não gera link; chatId é obrigatório', async () => {
    const velha = await gerarChave();
    const nova = await gerarChave();
    expect((await link(velha, { chatId: '1' })).status).toBe(401);
    expect((await link(nova, {})).status).toBe(400);
    await prisma.loja.update({ where: { id: loja.lojaId }, data: { status: 'bloqueada' } });
    expect((await link(nova, { chatId: '1' })).status).toBe(403);
  });
});
