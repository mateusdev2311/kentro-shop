import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Conector } from '../src/conectores/nucleo/conector';
import { RecusadoPelaPlataforma } from '../src/conectores/nucleo/erros';
import { criarAppDeTeste } from './app';
import { conectorFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
const SEGREDO = 'segredo-do-app';
let ipSeq = 0;

/** Plataforma com OAuth em memória (o conector de verdade é testado com a Nuvemshop simulada). */
const nuvemFalsa: Conector = {
  ...conectorFalso,
  id: 'nuvemshop',
  nome: 'Nuvemshop',
  capacidades: { ...conectorFalso.capacidades, oauth: true },
  camposDeCredencial: [],
  urlDeAutorizacao: (estado) => `https://plataforma.teste/autorizar?state=${encodeURIComponent(estado)}`,
  async concluirAutorizacao(_ctx, params) {
    if (params.code !== 'certo') throw new RecusadoPelaPlataforma('Código recusado pela plataforma.');
    return { access_token: 'tok', store_id: '555' };
  },
  idExterno: (c) => c.store_id ?? null,
  async testarConexao(ctx) {
    return ctx.credenciais.access_token === 'tok' ? { ok: true, nomeLoja: 'Loja Nuvem' } : { ok: false, mensagem: 'Token recusado.' };
  },
};

describe('Nuvemshop: autorização (OAuth) e webhooks de LGPD', () => {
  let app: INestApplication;
  let loja: { lojaId: string; chaveAdmin: string; chaveAtendimento: string };
  const http = () => request(app.getHttpServer());

  async function linkDeAutorizacao(): Promise<string> {
    const r = await http().post('/v1/loja/integracao/oauth/iniciar').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma: 'nuvemshop' });
    expect(r.status).toBe(200);
    return new URL(r.body.url).searchParams.get('state')!;
  }
  const retorno = (consulta: Record<string, string>) => http().get('/v1/oauth/retorno/nuvemshop').query(consulta);
  const webhook = (caminho: string, corpo: object, assinatura?: string) => {
    const bruto = JSON.stringify(corpo);
    return http()
      .post(`/v1/nuvemshop/lgpd/${caminho}`)
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', assinatura ?? createHmac('sha256', SEGREDO).update(bruto).digest('hex'))
      .send(bruto);
  };
  async function conectar(): Promise<void> {
    expect((await retorno({ code: 'certo', state: await linkDeAutorizacao() })).status).toBe(200);
  }

  beforeAll(async () => {
    app = await criarAppDeTeste({ nuvemshop: { appId: '47447', clientSecret: SEGREDO } }, { conectores: [conectorFalso, nuvemFalsa] });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    ipSeq += 1;
    loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.8.0.${ipSeq}`).send({ nome: 'Loja N' })).body;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('autorizar conecta a loja: grava o token cifrado com o store_id, testa e ativa', async () => {
    const r = await retorno({ code: 'certo', state: await linkDeAutorizacao() });
    expect(r.status).toBe(200);
    expect(r.type).toBe('text/html');
    expect(r.text).toContain('Nuvemshop conectada');
    expect(r.text).toContain('Loja Nuvem');
    const linha = await prisma.integracao.findUniqueOrThrow({ where: { lojaId: loja.lojaId } });
    expect(linha).toMatchObject({ plataforma: 'nuvemshop', idExterno: '555', status: 'ok' });
    expect(JSON.stringify(linha)).not.toContain('"tok"');
    expect((await prisma.loja.findUniqueOrThrow({ where: { id: loja.lojaId } })).status).toBe('ativa');
    const lida = await http().get('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin);
    expect(lida.body).toMatchObject({ plataforma: 'nuvemshop', status: 'ok', conectada: true, credenciais: {} });
  });

  it('só o admin pede o link; plataforma sem OAuth não tem link', async () => {
    const r = await http().post('/v1/loja/integracao/oauth/iniciar').set('X-Loja-Chave', loja.chaveAtendimento).send({ plataforma: 'nuvemshop' });
    expect(r.status).toBe(403);
    const falso = await http().post('/v1/loja/integracao/oauth/iniciar').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma: 'falso' });
    expect(falso.body.erro.codigo).toBe('SEM_OAUTH');
  });

  it('state adulterado ou ausente (instalação pela loja de aplicativos) não conecta e explica', async () => {
    const state = await linkDeAutorizacao();
    const consultas: Record<string, string>[] = [{ code: 'certo', state: `${state}x` }, { code: 'certo' }];
    for (const consulta of consultas) {
      const r = await retorno(consulta);
      expect(r.status).toBe(400);
      expect(r.text).toContain('Comece pelo Kentro Shop');
    }
    expect(await prisma.integracao.count()).toBe(0);
  });

  it('lojista recusou ou o código não vale: mostra o motivo e não grava nada', async () => {
    const recusou = await retorno({ error: 'access_denied', state: await linkDeAutorizacao() });
    expect(recusou.status).toBe(400);
    expect(recusou.text).toContain('Autorização não concluída');
    const invalido = await retorno({ code: 'errado', state: await linkDeAutorizacao() });
    expect(invalido.status).toBe(502);
    expect(invalido.text).toContain('Código recusado pela plataforma.');
    expect(await prisma.integracao.count()).toBe(0);
  });

  it('o formulário comum não grava plataforma com OAuth (apagaria o token)', async () => {
    const r = await http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma: 'nuvemshop', credenciais: {} });
    expect(r.status).toBe(400);
    expect(r.body.erro.codigo).toBe('USE_CONECTAR');
  });

  it('store/redact (app desinstalado): apaga a integração e a loja volta a pedir integração', async () => {
    await conectar();
    expect((await webhook('store-redact', { store_id: 555 })).status).toBe(200);
    expect(await prisma.integracao.count()).toBe(0);
    expect((await prisma.loja.findUniqueOrThrow({ where: { id: loja.lojaId } })).status).toBe('pendente_integracao');
  });

  it('assinatura errada é recusada e nada muda', async () => {
    await conectar();
    expect((await webhook('store-redact', { store_id: 555 }, 'f'.repeat(64))).status).toBe(401);
    expect((await webhook('customers-data-request', { store_id: 555 }, '')).status).toBe(401);
    expect(await prisma.integracao.count()).toBe(1);
  });

  it('customers/redact apaga o histórico do cliente pelo telefone ou e-mail, só na loja dessa conta', async () => {
    await conectar();
    await prisma.clienteLoja.createMany({
      data: [
        { lojaId: loja.lojaId, telefone: '5538988887777', nome: 'Ana' },
        { lojaId: loja.lojaId, telefone: '5511900000000', nome: 'Bia', email: 'Bia@Exemplo.com' },
        { lojaId: loja.lojaId, telefone: '5521911111111', nome: 'Caio' },
      ],
    });
    await webhook('customers-redact', { store_id: 555, customer: { id: 1, email: '', phone: '(38) 98888-7777' } });
    await webhook('customers-redact', { store_id: 555, customer: { id: 2, email: 'bia@exemplo.com', phone: '' } });
    await webhook('customers-redact', { store_id: 999, customer: { id: 3, phone: '+55 21 91111-1111' } }); // outra conta
    expect((await prisma.clienteLoja.findMany({ where: { lojaId: loja.lojaId } })).map((c) => c.nome)).toEqual(['Caio']);
  });

  it('customers/data_request responde 200', async () => {
    expect((await webhook('customers-data-request', { store_id: 555, customer: { id: 1 } })).status).toBe(200);
  });
});
