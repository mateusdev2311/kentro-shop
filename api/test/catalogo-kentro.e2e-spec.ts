import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { conectorKentro } from '../src/conectores/kentro/kentro.conector';
import { criarAppDeTeste } from './app';
import { conectorFalso } from './conectores/conector-falso';
import { GRUPOS_SDK, PRODUTOS_SDK } from './conectores/catalogo-memoria';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

interface Loja {
  lojaId: string;
  chaveAdmin: string;
  chaveAtendimento: string;
}

describe('catálogo da Kentro sincronizado pela extensão', () => {
  let app: INestApplication;
  let loja: Loja;
  const http = () => request(app.getHttpServer());
  const lote = (chave: string, corpo: object) => http().post('/v1/loja/catalogo-kentro/lotes').set('X-Loja-Chave', chave).send(corpo);
  const estado = (chave: string) => http().get('/v1/loja/catalogo-kentro').set('X-Loja-Chave', chave);
  const usarKentro = (chave: string) => http().put('/v1/loja/integracao').set('X-Loja-Chave', chave).send({ plataforma: 'kentro', credenciais: {} });
  const grupos = GRUPOS_SDK.map((g) => ({ id: Number(g.id), nome: g.nome }));

  /** Sincroniza tudo numa parte só. */
  const sincronizar = (chave: string, produtos: object[] = PRODUTOS_SDK, id = 'lote-0001') => lote(chave, { lote: id, parte: 0, ultima: true, produtos, grupos });

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { conectores: [conectorFalso, conectorKentro] });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    ipSeq += 1;
    loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.7.0.${ipSeq}`).send({ nome: 'Loja K' })).body;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('integração sem endereço nem token; o teste pede a sincronização até ela acontecer', async () => {
    expect((await usarKentro(loja.chaveAdmin)).status).toBe(200);
    const antes = await http().post('/v1/loja/integracao/testar').set('X-Loja-Chave', loja.chaveAdmin);
    expect(antes.body).toEqual({ ok: false, mensagem: 'O catálogo da Kentro ainda não foi sincronizado. Clique em "Sincronizar agora".' });

    const r = await sincronizar(loja.chaveAdmin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recebidos: 4, total: 4 });

    const depois = await http().post('/v1/loja/integracao/testar').set('X-Loja-Chave', loja.chaveAdmin);
    expect(depois.body).toEqual({ ok: true, nomeLoja: 'Catálogo da Kentro (4 produtos)' });
    expect((await estado(loja.chaveAtendimento)).body).toMatchObject({ total: 4, categorias: 2, sincronizando: false });
  });

  it('o catálogo lê a cópia: busca sem acento, categoria e produto pelo id ou SKU', async () => {
    await usarKentro(loja.chaveAdmin);
    await sincronizar(loja.chaveAdmin);
    const ler = (caminho: string) => http().get(`/v1/loja/catalogo${caminho}`).set('X-Loja-Chave', loja.chaveAtendimento);
    expect((await ler('/categorias')).body).toEqual([
      { id: '1', nome: 'Pisos' },
      { id: '2', nome: 'Tintas' },
    ]);
    expect((await ler('/produtos?busca=acrilica')).body.itens.map((p: { nome: string }) => p.nome)).toEqual(['Tinta Acrílica']);
    expect((await ler('/produtos?categoria=1')).body.itens.map((p: { id: string }) => p.id)).toEqual(['6', '1', '5']);
    expect((await ler('/produtos/ARG')).body).toMatchObject({ id: '6', preco: 39.9 });
    expect((await ler('/produtos/4')).status).toBe(404); // oculto para clientes não entra
  });

  it('em partes: a troca só acontece na última, e o que sumiu da Kentro sai da cópia', async () => {
    await usarKentro(loja.chaveAdmin);
    await sincronizar(loja.chaveAdmin);
    expect((await lote(loja.chaveAdmin, { lote: 'lote-0002', parte: 0, ultima: false, produtos: [PRODUTOS_SDK[0]] })).body).toEqual({ recebidos: 1 });
    expect((await estado(loja.chaveAdmin)).body).toMatchObject({ total: 4, sincronizando: true });
    const fim = await lote(loja.chaveAdmin, { lote: 'lote-0002', parte: 1, ultima: true, produtos: [{ ...PRODUTOS_SDK[3], price: 45 }], grupos });
    expect(fim.body).toMatchObject({ total: 2 });
    const ids = (await prisma.produtoKentro.findMany({ where: { lojaId: loja.lojaId }, orderBy: { id: 'asc' } })).map((p) => p.id);
    expect(ids).toEqual(['1', '6']);
    // Tintas ficou sem produto: some das categorias.
    expect((await http().get('/v1/loja/catalogo/categorias').set('X-Loja-Chave', loja.chaveAdmin)).body).toEqual([{ id: '1', nome: 'Pisos' }]);
    expect((await http().get('/v1/loja/catalogo/produtos/6').set('X-Loja-Chave', loja.chaveAdmin)).body.preco).toBe(45);
  });

  it('uma sincronização por vez; parte de lote encerrado é recusada', async () => {
    await usarKentro(loja.chaveAdmin);
    await lote(loja.chaveAdmin, { lote: 'lote-aaaa', parte: 0, ultima: false, produtos: [PRODUTOS_SDK[0]] });
    const outra = await lote(loja.chaveAtendimento, { lote: 'lote-bbbb', parte: 0, ultima: false, produtos: [PRODUTOS_SDK[0]] });
    expect(outra.status).toBe(409);
    expect(outra.body.erro.codigo).toBe('SINCRONIZANDO');
    const perdida = await lote(loja.chaveAtendimento, { lote: 'lote-cccc', parte: 3, ultima: true, produtos: [] });
    expect(perdida.body.erro.codigo).toBe('LOTE_ENCERRADO');
  });

  it('sincronização do atendente que encolhe o catálogo pela metade é ignorada; a do admin vale', async () => {
    await usarKentro(loja.chaveAdmin);
    await sincronizar(loja.chaveAdmin);
    const doAtendente = await sincronizar(loja.chaveAtendimento, [PRODUTOS_SDK[0]], 'lote-0003');
    expect(doAtendente.status).toBe(409);
    expect(doAtendente.body.erro.codigo).toBe('CATALOGO_ENCOLHEU');
    expect(await prisma.produtoKentro.count({ where: { lojaId: loja.lojaId } })).toBe(4);
    expect((await sincronizar(loja.chaveAdmin, [PRODUTOS_SDK[0]], 'lote-0004')).body).toMatchObject({ total: 1 });
  });

  it('sem os nomes dos grupos, mantém os da sincronização anterior', async () => {
    await usarKentro(loja.chaveAdmin);
    await sincronizar(loja.chaveAdmin);
    await lote(loja.chaveAdmin, { lote: 'lote-0005', parte: 0, ultima: true, produtos: PRODUTOS_SDK });
    expect((await estado(loja.chaveAdmin)).body.categorias).toBe(2);
  });

  it('recusa loja que não usa o catálogo da Kentro e entrada fora do formato', async () => {
    const r = await sincronizar(loja.chaveAdmin);
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('PLATAFORMA_DIFERENTE');
    await usarKentro(loja.chaveAdmin);
    expect((await lote(loja.chaveAdmin, { lote: 'x', parte: 0, ultima: true, produtos: [] })).status).toBe(400);
    expect((await lote(loja.chaveAdmin, { lote: 'lote-0006', parte: 0, ultima: true, produtos: Array(251).fill({}) })).status).toBe(400);
    expect((await lote('chave-errada', { lote: 'lote-0007', parte: 0, ultima: true, produtos: [] })).status).toBe(401);
  });
});
