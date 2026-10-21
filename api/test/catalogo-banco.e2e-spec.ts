import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { conectorAutomatiza, idCategoria } from '../src/conectores/automatiza/automatiza.conector';
import { conectorKentro } from '../src/conectores/kentro/kentro.conector';
import { AbrirBanco } from '../src/conectores/nucleo/banco';
import { SincronizacaoService } from '../src/integracoes/sincronizacao.service';
import { criarAppDeTeste } from './app';
import { bancoEmMemoria, CREDENCIAIS_BANCO, LINHAS_VIEW, OpcoesBancoMemoria } from './conectores/banco-memoria';
import { PRODUTOS_SDK } from './conectores/catalogo-memoria';
import { conectorFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

describe('catálogo de banco de dados sincronizado pela API (ERP Automatiza)', () => {
  let app: INestApplication;
  let loja: { lojaId: string; chaveAdmin: string; chaveAtendimento: string };
  /** O que o banco falso responde agora (cada teste muda). */
  let banco: OpcoesBancoMemoria = {};
  /** Consultas feitas ao banco (abrir o cliente não conecta; só consultar). */
  const abertos: { lojaId: string; motor: string; bancoPadrao?: string; operacao: string }[] = [];
  const abrirBanco: AbrirBanco = (o) => {
    const cliente = bancoEmMemoria(o.credenciais, banco);
    return {
      consultar: (operacao, sql, parametros) => {
        abertos.push({ lojaId: o.lojaId, motor: o.motor, bancoPadrao: o.bancoPadrao, operacao });
        return cliente.consultar(operacao, sql, parametros);
      },
    };
  };

  const http = () => request(app.getHttpServer());
  const salvar = (credenciais: object = CREDENCIAIS_BANCO, plataforma = 'automatiza') =>
    http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma, credenciais });
  const sincronizar = (chave = loja.chaveAdmin) => http().post('/v1/loja/catalogo-sincronizado/sincronizar').set('X-Loja-Chave', chave);
  const estado = () => http().get('/v1/loja/catalogo-sincronizado').set('X-Loja-Chave', loja.chaveAtendimento);
  const testar = () => http().post('/v1/loja/integracao/testar').set('X-Loja-Chave', loja.chaveAdmin);
  const produtos = (query = '') => http().get(`/v1/loja/catalogo/produtos${query}`).set('X-Loja-Chave', loja.chaveAtendimento);

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { conectores: [conectorFalso, conectorKentro, conectorAutomatiza], abrirBanco });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    banco = {};
    abertos.length = 0;
    ipSeq += 1;
    loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.9.0.${ipSeq}`).send({ nome: 'Farmácia' })).body;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('o conector aparece com a sincronização e os campos do banco (senha mascarada na leitura)', async () => {
    const lista = (await http().get('/v1/conectores').set('X-Loja-Chave', loja.chaveAdmin)).body as { id: string; sincronizacao?: object; camposDeCredencial: { chave: string }[] }[];
    const automatiza = lista.find((c) => c.id === 'automatiza')!;
    expect(automatiza.sincronizacao).toEqual({ minutos: 15 });
    expect(automatiza.camposDeCredencial.map((c) => c.chave)).toEqual(['host', 'porta', 'usuario', 'senha', 'banco']);
    expect(lista.find((c) => c.id === 'falso')!.sincronizacao).toBeUndefined();

    expect((await salvar()).body.credenciais).toEqual({ ...CREDENCIAIS_BANCO, senha: '••••', banco: undefined });
  });

  it('recusa salvar servidor da rede interna', async () => {
    const r = await salvar({ ...CREDENCIAIS_BANCO, host: '10.0.0.8' });
    expect(r.status).toBe(400);
    expect(r.body.erro.mensagem).toMatch(/endereço público/);
  });

  it('salvar, sincronizar e testar: o catálogo lê a cópia (busca pelo código de barras), sem ir ao banco', async () => {
    await salvar();
    expect((await testar()).body).toEqual({
      ok: false,
      mensagem: 'Banco conectado (FARMACIA TESTE - LOJA07), mas os produtos ainda não foram sincronizados. Clique em "Sincronizar agora".',
    });

    const r = await sincronizar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 5, categorias: 3, sincronizando: false, ultimoErro: null });
    expect(abertos.at(-1)).toEqual({ lojaId: loja.lojaId, motor: 'mysql', bancoPadrao: 'automatiza', operacao: 'sincronizar_catalogo' });

    expect((await testar()).body).toEqual({ ok: true, nomeLoja: 'FARMACIA TESTE - LOJA07 (5 produtos)' });
    expect((await http().get('/v1/loja').set('X-Loja-Chave', loja.chaveAdmin)).body.status).toBe('ativa');

    abertos.length = 0;
    expect((await produtos('?busca=7890000000104')).body.itens.map((p: { nome: string }) => p.nome)).toEqual(['PROTETOR SOLAR FPS50 120ML']);
    expect((await produtos(`?categoria=${idCategoria('DERMOCOSMETICOS')}`)).body.itens).toHaveLength(2);
    const categorias = (await http().get('/v1/loja/catalogo/categorias').set('X-Loja-Chave', loja.chaveAtendimento)).body;
    expect(categorias.map((c: { nome: string }) => c.nome)).toEqual(['Dermocosmeticos', 'Generico OTC', 'Higiene e Beleza']);
    expect(abertos).toEqual([]); // as leituras do catálogo não abrem o banco

    // O registro de chamadas (aba Saúde) tem a leitura do banco, sem SQL nem credencial.
    const chamadas = await prisma.chamadaConector.findMany({ where: { lojaId: loja.lojaId }, select: { plataforma: true } });
    expect(chamadas.every((c) => c.plataforma === 'automatiza')).toBe(true);
  });

  it('só o admin sincroniza', async () => {
    await salvar();
    expect((await sincronizar(loja.chaveAtendimento)).status).toBe(403);
  });

  it('falha no banco: a cópia anterior continua e o motivo fica no estado', async () => {
    await salvar();
    await sincronizar();
    banco = { fora: true };
    const r = await sincronizar();
    expect(r.status).toBe(502);
    expect((await estado()).body).toMatchObject({ total: 5, ultimoErro: 'A plataforma de e-commerce não respondeu. Tente de novo em instantes.' });
    expect((await produtos()).body.itens).toHaveLength(5);

    banco = {};
    expect((await sincronizar()).body).toMatchObject({ total: 5, ultimoErro: null });
  });

  it('nada veio do banco: recusa e mantém a cópia; a automática também recusa perder mais da metade', async () => {
    await salvar();
    await sincronizar();
    banco = { linhas: [] };
    expect((await sincronizar()).body.erro.codigo).toBe('CATALOGO_VAZIO');

    banco = { linhas: LINHAS_VIEW.slice(0, 2) };
    const sinc = app.get(SincronizacaoService);
    await expect(sinc.sincronizar(loja.lojaId, { automatica: true })).rejects.toMatchObject({ codigo: 'CATALOGO_ENCOLHEU' });
    expect((await estado()).body.total).toBe(5);
    // A manual aceita: alguém pediu e está olhando.
    expect((await sincronizar()).body.total).toBe(2);
  });

  it('plataforma lida ao vivo não sincroniza', async () => {
    await salvar({ url_api: 'https://api.teste', token: 'certo' }, 'falso');
    const r = await sincronizar();
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('SEM_SINCRONIZACAO');
  });

  it('trocar de plataforma apaga a cópia da anterior', async () => {
    await http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma: 'kentro', credenciais: {} });
    await http()
      .post('/v1/loja/catalogo-kentro/lotes')
      .set('X-Loja-Chave', loja.chaveAdmin)
      .send({ lote: 'lote-0001', parte: 0, ultima: true, produtos: PRODUTOS_SDK });
    expect((await estado()).body.total).toBe(4);

    await salvar();
    expect((await estado()).body).toMatchObject({ total: 0, sincronizadoEm: null });
    expect((await testar()).body.ok).toBe(false); // não aparece o catálogo da Kentro como se fosse o do banco
  });

  it('rodada automática: sincroniza a cópia vencida e respeita a validade (também depois de falha)', async () => {
    await salvar();
    const sinc = app.get(SincronizacaoService);
    const agora = Date.now();
    await sinc.rodada(agora);
    expect((await estado()).body.total).toBe(5);

    abertos.length = 0;
    await sinc.rodada(agora + 5 * 60_000); // ainda vale (15 min)
    expect(abertos).toEqual([]);

    banco = { fora: true };
    await sinc.rodada(agora + 16 * 60_000); // vencida: tenta e falha sem derrubar a rodada
    expect((await estado()).body.ultimoErro).toBeTruthy();
    abertos.length = 0;
    await sinc.rodada(Date.now() + 5 * 60_000); // espera o intervalo depois da falha
    expect(abertos).toEqual([]);

    await prisma.loja.update({ where: { id: loja.lojaId }, data: { status: 'bloqueada' } });
    banco = {};
    await sinc.rodada(Date.now() + 60 * 60_000); // loja bloqueada fica de fora
    expect(abertos).toEqual([]);
  });
});
