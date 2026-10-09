import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './app';

describe('saúde e erros', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rota inexistente responde no formato padrão com NAO_ENCONTRADO', async () => {
    const res = await request(app.getHttpServer()).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
    expect(typeof res.body.erro.mensagem).toBe('string');
  });
});
