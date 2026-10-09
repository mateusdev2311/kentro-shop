import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';

interface Registro {
  lojaId: string;
  chaveAdmin: string;
  chaveAtendimento: string;
  tokenMcp: string;
}

const prisma = new PrismaClient();
let ipSeq = 0;

// Cada registro sai de um IP diferente para o limite por IP não interferir nos outros testes.
async function registrar(app: INestApplication, corpo: object = { nome: 'Loja Teste' }): Promise<Registro> {
  ipSeq += 1;
  const res = await request(app.getHttpServer())
    .post('/v1/lojas/registrar')
    .set('X-Forwarded-For', `10.0.0.${ipSeq}`)
    .send(corpo);
  expect(res.status).toBe(201);
  return res.body;
}

function loja(app: INestApplication, chave?: string) {
  const req = request(app.getHttpServer()).get('/v1/loja');
  return chave === undefined ? req : req.set('X-Loja-Chave', chave);
}

afterAll(() => prisma.$disconnect());

describe('registro e chaves da loja', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(() => limparBanco(prisma));
  afterAll(() => app.close());

  it('registra a loja e devolve três segredos diferentes com os prefixos certos', async () => {
    const r = await registrar(app);
    expect(r.lojaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.chaveAdmin).toMatch(/^ksa_/);
    expect(r.chaveAtendimento).toMatch(/^ksk_/);
    expect(r.tokenMcp).toMatch(/^ksm_/);
    expect(new Set([r.chaveAdmin, r.chaveAtendimento, r.tokenMcp]).size).toBe(3);
  });

  it('não guarda nenhum segredo em claro no banco', async () => {
    const r = await registrar(app);
    const linha = JSON.stringify(await prisma.loja.findUniqueOrThrow({ where: { id: r.lojaId } }));
    for (const segredo of [r.chaveAdmin, r.chaveAtendimento, r.tokenMcp]) {
      expect(linha).not.toContain(segredo);
      expect(linha).not.toContain(segredo.slice(4));
    }
  });

  it('identifica o papel pela chave usada', async () => {
    const r = await registrar(app);
    const comAdmin = await loja(app, r.chaveAdmin);
    expect(comAdmin.status).toBe(200);
    expect(comAdmin.body).toEqual({ id: r.lojaId, nome: 'Loja Teste', status: 'pendente_integracao', plano: 'gratis', papel: 'admin' });
    const comAtendimento = await loja(app, r.chaveAtendimento);
    expect(comAtendimento.body.papel).toBe('atendimento');
  });

  // Quebra de linha não chega aqui (HTTP não permite em cabeçalho); a extensão é quem remove (Tarefa 7).
  it('aceita a chave colada com espaços e tab nas pontas', async () => {
    const r = await registrar(app);
    expect((await loja(app, `  ${r.chaveAtendimento}\t`)).status).toBe(200);
  });

  it('recusa sem chave ou com chave desconhecida', async () => {
    const sem = await loja(app);
    expect(sem.status).toBe(401);
    expect(sem.body.erro.codigo).toBe('CHAVE_INVALIDA');
    const desconhecida = await loja(app, 'ksa_inexistente');
    expect(desconhecida.status).toBe(401);
    expect(desconhecida.body.erro.codigo).toBe('CHAVE_INVALIDA');
  });

  it('não deixa a chave de atendimento fazer ação de admin', async () => {
    const r = await registrar(app);
    const res = await request(app.getHttpServer()).post('/v1/loja/chave-admin/rotacionar').set('X-Loja-Chave', r.chaveAtendimento);
    expect(res.status).toBe(403);
    expect(res.body.erro.codigo).toBe('PERMISSAO_NEGADA');
  });

  it.each([
    ['chave-admin', 'chaveAdmin', /^ksa_/],
    ['chave-atendimento', 'chaveAtendimento', /^ksk_/],
  ] as const)('rotacionar %s invalida a chave antiga na hora', async (rota, campo, prefixo) => {
    const r = await registrar(app);
    const res = await request(app.getHttpServer()).post(`/v1/loja/${rota}/rotacionar`).set('X-Loja-Chave', r.chaveAdmin);
    expect(res.status).toBe(200);
    expect(res.body.chave).toMatch(prefixo);
    expect((await loja(app, r[campo])).status).toBe(401);
    expect((await loja(app, res.body.chave)).status).toBe(200);
  });

  it('rotacionar o token MCP troca o hash guardado', async () => {
    const r = await registrar(app);
    const antes = await prisma.loja.findUniqueOrThrow({ where: { id: r.lojaId } });
    const res = await request(app.getHttpServer()).post('/v1/loja/token-mcp/rotacionar').set('X-Loja-Chave', r.chaveAdmin);
    expect(res.status).toBe(200);
    expect(res.body.chave).toMatch(/^ksm_/);
    const depois = await prisma.loja.findUniqueOrThrow({ where: { id: r.lojaId } });
    expect(depois.tokenMcpHash).not.toBe(antes.tokenMcpHash);
  });

  it('cada chave enxerga só a própria loja', async () => {
    const a = await registrar(app, { nome: 'Loja A' });
    const b = await registrar(app, { nome: 'Loja B' });
    expect((await loja(app, a.chaveAtendimento)).body.id).toBe(a.lojaId);
    expect((await loja(app, b.chaveAtendimento)).body.id).toBe(b.lojaId);
  });

  it('loja bloqueada não é atendida', async () => {
    const r = await registrar(app);
    await prisma.loja.update({ where: { id: r.lojaId }, data: { status: 'bloqueada' } });
    const res = await loja(app, r.chaveAtendimento);
    expect(res.status).toBe(403);
    expect(res.body.erro.codigo).toBe('LOJA_BLOQUEADA');
  });

  it('nome é opcional', async () => {
    const r = await registrar(app, {});
    expect((await loja(app, r.chaveAdmin)).body.nome).toBeNull();
  });

  it('recusa campo desconhecido no registro', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/lojas/registrar')
      .set('X-Forwarded-For', '10.1.0.1')
      .send({ nome: 'x', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('ENTRADA_INVALIDA');
  });

  it('recusa JSON malformado sem erro interno', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/lojas/registrar')
      .set('X-Forwarded-For', '10.1.0.2')
      .set('Content-Type', 'application/json')
      .send('{nome:');
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('ENTRADA_INVALIDA');
  });
});

describe('limite de registros por IP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  afterAll(() => app.close());

  it('o sexto registro do mesmo IP na mesma hora é recusado', async () => {
    const enviar = () => request(app.getHttpServer()).post('/v1/lojas/registrar').set('X-Forwarded-For', '10.9.9.9').send({});
    for (let i = 0; i < 5; i++) expect((await enviar()).status).toBe(201);
    const sexto = await enviar();
    expect(sexto.status).toBe(429);
    expect(sexto.body.erro.codigo).toBe('LIMITE_DE_REQUISICOES');
  });

  // Todas as chamadas das extensões saem do mesmo IP (o backend da Kentro): o limite
  // precisa ser por instância, senão uma instância esgota o cadastro de todas as outras.
  it('instâncias da Kentro que saem do mesmo IP têm limites separados', async () => {
    const enviar = (instancia: string) =>
      request(app.getHttpServer())
        .post('/v1/lojas/registrar')
        .set('X-Forwarded-For', '10.8.8.8')
        .set('X-Kentro-Instancia', instancia)
        .send({});
    for (let i = 0; i < 5; i++) expect((await enviar('a.kentro.test')).status).toBe(201);
    expect((await enviar('a.kentro.test')).status).toBe(429);
    expect((await enviar('b.kentro.test')).status).toBe(201);
  });
});
