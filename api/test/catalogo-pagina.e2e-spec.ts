import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './app';

describe('página do catálogo', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const dirPublic = mkdtempSync(path.join(tmpdir(), 'kentro-shop-public-'));
    writeFileSync(path.join(dirPublic, 'index.html'), '<!doctype html><div id="app"></div>');
    mkdirSync(path.join(dirPublic, 'assets'));
    writeFileSync(path.join(dirPublic, 'assets', 'a.js'), 'console.log(1)');
    app = await criarAppDeTeste({ dirPublic });
  });
  afterAll(() => app.close());

  it('GET /c/:token entrega a página do catálogo sem cache', async () => {
    const res = await request(app.getHttpServer()).get('/c/qualquer-token');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.text).toContain('id="app"');
  });

  it('serve os arquivos do build do catálogo', async () => {
    const res = await request(app.getHttpServer()).get('/assets/a.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log(1)');
  });

  it('a raiz continua sendo a verificação de saúde', async () => {
    expect((await request(app.getHttpServer()).get('/')).body).toEqual({ ok: true });
  });
});
