import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

interface Loja {
  lojaId: string;
  chaveAdmin: string;
  chaveAtendimento: string;
}

describe('integração da loja com o e-commerce', () => {
  let app: INestApplication;
  let loja: Loja;
  const http = () => request(app.getHttpServer());
  const salvar = (chave: string, corpo: object) => http().put('/v1/loja/integracao').set('X-Loja-Chave', chave).send(corpo);
  const testar = (chave: string) => http().post('/v1/loja/integracao/testar').set('X-Loja-Chave', chave);

  async function registrar(): Promise<Loja> {
    ipSeq += 1;
    const res = await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.3.0.${ipSeq}`).send({ nome: 'Loja I' });
    return res.body;
  }

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    loja = await registrar();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lista os conectores com os campos de credencial (qualquer chave)', async () => {
    const res = await http().get('/v1/conectores').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(res.status).toBe(200);
    const falso = res.body.find((c: { id: string }) => c.id === 'falso');
    expect(falso.camposDeCredencial.map((c: { chave: string }) => c.chave)).toEqual(['url_api', 'token']);
    expect(falso.capacidades.buscaTextual).toBe(true);
  });

  it('guarda a credencial aparada, cifrada e mascarada na leitura', async () => {
    const res = await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: ' https://api.teste ', token: ' certo \n' } });
    expect(res.status).toBe(200);
    const lido = await http().get('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin);
    expect(lido.body).toMatchObject({ plataforma: 'falso', status: 'pendente', credenciais: { url_api: 'https://api.teste', token: '••••' } });
    const linha = await prisma.integracao.findUniqueOrThrow({ where: { lojaId: loja.lojaId } });
    expect(JSON.stringify(linha)).not.toContain('certo');
    expect((await testar(loja.chaveAdmin)).body).toEqual({ ok: true, nomeLoja: 'Loja Falsa' });
  });

  it('valida campos obrigatórios, desconhecidos e a plataforma', async () => {
    expect((await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { token: 'x' } })).status).toBe(400);
    expect((await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'u', token: 'x', extra: 'y' } })).status).toBe(400);
    expect((await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'u', token: 7 } })).status).toBe(400);
    const plataforma = await salvar(loja.chaveAdmin, { plataforma: 'nao-existe', credenciais: {} });
    expect(plataforma.status).toBe(404);
  });

  it('reenviar a máscara mantém o segredo gravado', async () => {
    await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://a.teste/api', token: 'certo' } });
    await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://a.teste/v2', token: '••••' } });
    expect((await testar(loja.chaveAdmin)).body.ok).toBe(true);
    const lido = await http().get('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin);
    expect(lido.body.credenciais.url_api).toBe('https://a.teste/v2');
  });

  it('trocar o endereço exige digitar o segredo de novo (o segredo não vai para outro servidor)', async () => {
    await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://a.teste/api', token: 'certo' } });
    const res = await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://outro.teste/api', token: '••••' } });
    expect(res.status).toBe(400);
    expect(res.body.erro.mensagem).toBe('Ao trocar o endereço, digite de novo: Token.');
  });

  it.each(['http://api.teste', 'https://127.0.0.1/api', 'https://169.254.169.254/latest', 'https://localhost:3000', 'nao-e-url'])(
    'recusa endereço que não é https público: %s',
    async (url) => {
      const res = await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: url, token: 'certo' } });
      expect(res.status).toBe(400);
      expect(res.body.erro.mensagem).toBe('O campo Endereço da API precisa começar com https:// e apontar para um endereço público.');
    },
  );

  it('teste ok ativa a loja; teste com falha registra o erro', async () => {
    await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://a', token: 'certo' } });
    await testar(loja.chaveAdmin);
    const ativa = await http().get('/v1/loja').set('X-Loja-Chave', loja.chaveAdmin);
    expect(ativa.body.status).toBe('ativa');
    expect((await http().get('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin)).body.status).toBe('ok');

    await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://a', token: 'errado' } });
    expect((await testar(loja.chaveAdmin)).body).toEqual({ ok: false, mensagem: 'Token recusado.' });
    const lido = await http().get('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin);
    expect(lido.body).toMatchObject({ status: 'erro', ultimoErro: 'Token recusado.' });
  });

  it('testar sem integração explica o que fazer', async () => {
    const res = await testar(loja.chaveAdmin);
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('SEM_INTEGRACAO');
  });

  it('chave de atendimento não mexe na integração', async () => {
    const res = await salvar(loja.chaveAtendimento, { plataforma: 'falso', credenciais: { url_api: 'u', token: 'certo' } });
    expect(res.status).toBe(403);
    expect((await testar(loja.chaveAtendimento)).status).toBe(403);
    expect((await http().get('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAtendimento)).status).toBe(403);
  });

  it('uma loja não enxerga a integração de outra', async () => {
    await salvar(loja.chaveAdmin, { plataforma: 'falso', credenciais: { url_api: 'https://a', token: 'certo' } });
    const outra = await registrar();
    expect((await http().get('/v1/loja/integracao').set('X-Loja-Chave', outra.chaveAdmin)).status).toBe(404);
  });
});
