import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste, TOKEN_SUPERADMIN_TESTE } from './app';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

describe('rotas de superadmin', () => {
  let app: INestApplication;
  let loja: { lojaId: string; chaveAtendimento: string };
  const comToken = (req: request.Test) => req.set('Authorization', `Bearer ${TOKEN_SUPERADMIN_TESTE}`);

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    ipSeq += 1;
    const res = await request(app.getHttpServer()).post('/v1/lojas/registrar').set('X-Forwarded-For', `10.2.0.${ipSeq}`).send({ nome: 'Loja S' });
    loja = res.body;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('recusa sem token ou com token errado', async () => {
    const sem = await request(app.getHttpServer()).get('/v1/admin/lojas');
    expect(sem.status).toBe(401);
    expect(sem.body.erro.codigo).toBe('NAO_AUTORIZADO');
    const errado = await request(app.getHttpServer()).get('/v1/admin/lojas').set('Authorization', 'Bearer errado');
    expect(errado.status).toBe(401);
  });

  it('lista as lojas sem expor nenhum hash', async () => {
    const res = await comToken(request(app.getHttpServer()).get('/v1/admin/lojas'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: loja.lojaId, nome: 'Loja S', status: 'pendente_integracao', plano: 'gratis', limites: {} });
    expect(Object.keys(res.body[0]).some((k) => k.endsWith('Hash'))).toBe(false);
  });

  it('bloquear a loja faz a chave dela parar de funcionar', async () => {
    const res = await comToken(request(app.getHttpServer()).patch(`/v1/admin/lojas/${loja.lojaId}`)).send({ status: 'bloqueada' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('bloqueada');
    const depois = await request(app.getHttpServer()).get('/v1/loja').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(depois.status).toBe(403);
    expect(depois.body.erro.codigo).toBe('LOJA_BLOQUEADA');
  });

  it('altera plano e limites', async () => {
    const res = await comToken(request(app.getHttpServer()).patch(`/v1/admin/lojas/${loja.lojaId}`)).send({
      plano: 'pro',
      limites: { linksPorMes: 500 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plano: 'pro', limites: { linksPorMes: 500 } });
  });

  it('recusa status desconhecido', async () => {
    const res = await comToken(request(app.getHttpServer()).patch(`/v1/admin/lojas/${loja.lojaId}`)).send({ status: 'congelada' });
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('ENTRADA_INVALIDA');
  });

  it.each([randomUUID(), 'nao-e-uuid'])('loja inexistente (%s) dá 404', async (id) => {
    const res = await comToken(request(app.getHttpServer()).patch(`/v1/admin/lojas/${id}`)).send({ plano: 'pro' });
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });
});
