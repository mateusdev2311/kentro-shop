import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './app';

describe('arquivos das extensões', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://shop.teste' });
  });
  afterAll(() => app.close());

  it('serve o manifest com CORS e a URL pública preenchida', async () => {
    const res = await request(app.getHttpServer()).get('/extensao/atendimento/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-cache');
    const apiUrl = JSON.parse(res.text).config.find((c: { key: string }) => c.key === 'api_url');
    expect(apiUrl.default).toBe('https://shop.teste');
  });

  it('serve o HTML com CORS e tipo certo', async () => {
    const res = await request(app.getHttpServer()).get('/extensao/admin/config.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('responde ao preflight', async () => {
    const res = await request(app.getHttpServer()).options('/extensao/admin/manifest.json');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
  });

  it.each([
    '/extensao/outra/manifest.json',
    '/extensao/admin/..%2f..%2fpackage.json',
    '/extensao/admin/%2e%2e%2f%2e%2e%2fapi%2fpackage.json',
    '/extensao/admin/nao-existe.html',
    '/extensao/admin/config.exe',
  ])('%s dá 404 sem ler nada fora da pasta', async (caminho) => {
    const res = await request(app.getHttpServer()).get(caminho);
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });
});
