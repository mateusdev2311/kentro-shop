import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/comum/prisma.service';
import { criarAppDeTeste } from './app';
import { controleFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

interface Loja {
  lojaId: string;
  chaveAdmin: string;
  chaveAtendimento: string;
}

describe('regras por SKU e catálogo ao vivo', () => {
  let app: INestApplication;
  let loja: Loja;
  const http = () => request(app.getHttpServer());

  async function registrar(integrar = true): Promise<Loja> {
    ipSeq += 1;
    const r = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.4.0.${ipSeq}`).send({ nome: 'Loja C' })).body;
    if (integrar) {
      await http()
        .put('/v1/loja/integracao')
        .set('X-Loja-Chave', r.chaveAdmin)
        .send({ plataforma: 'falso', credenciais: { url_api: 'https://api.teste', token: 'certo' } });
    }
    return r;
  }
  const regra = (chave: string, sku: string, corpo: object) => http().put(`/v1/loja/regras/${sku}`).set('X-Loja-Chave', chave).send(corpo);
  const produtos = (chave: string, query = '') => http().get(`/v1/loja/catalogo/produtos${query}`).set('X-Loja-Chave', chave);

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    controleFalso.indisponivel = false;
    controleFalso.relacionados = [];
    await limparBanco(prisma);
    loja = await registrar();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lista os produtos ao vivo, 24 por página', async () => {
    const res = await produtos(loja.chaveAtendimento);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pagina: 1, porPagina: 24, temMais: false });
    expect(res.body.itens.map((p: { sku: string }) => p.sku)).toEqual(['A1', 'B2', 'C3']);
  });

  it('produto oculto sai da lista e selo aparece', async () => {
    await regra(loja.chaveAdmin, 'B2', { oculto: true });
    await regra(loja.chaveAdmin, 'A1', { selo: 'Mais vendido', m2PorUnidade: 1.44 });
    const res = await produtos(loja.chaveAtendimento);
    expect(res.body.itens.map((p: { sku: string }) => p.sku)).toEqual(['A1', 'C3']);
    expect(res.body.itens[0].regras).toEqual({ selo: 'Mais vendido', m2PorUnidade: 1.44, compreJunto: [] });
    expect(res.body.itens[1].regras).toBeUndefined();
  });

  it('repassa busca e categoria ao conector', async () => {
    expect((await produtos(loja.chaveAtendimento, '?busca=c3')).body.itens.map((p: { sku: string }) => p.sku)).toEqual(['C3']);
    expect((await produtos(loja.chaveAtendimento, '?categoria=2')).body.itens.map((p: { sku: string }) => p.sku)).toEqual(['B2']);
  });

  it('detalhe junta o compre junto da regra (primeiro) com os relacionados da plataforma', async () => {
    controleFalso.relacionados = ['R9', 'C3'];
    await regra(loja.chaveAdmin, 'A1', { compreJunto: ['C3', 'B2'] });
    const res = await http().get('/v1/loja/catalogo/produtos/A1').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(res.status).toBe(200);
    expect(res.body.regras.compreJunto).toEqual(['C3', 'B2', 'R9']);
  });

  it('produto oculto ou inexistente dá 404 no detalhe', async () => {
    await regra(loja.chaveAdmin, 'A1', { oculto: true });
    expect((await http().get('/v1/loja/catalogo/produtos/A1').set('X-Loja-Chave', loja.chaveAtendimento)).status).toBe(404);
    expect((await http().get('/v1/loja/catalogo/produtos/ZZ').set('X-Loja-Chave', loja.chaveAtendimento)).status).toBe(404);
  });

  it('lista as categorias', async () => {
    const res = await http().get('/v1/loja/catalogo/categorias').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(res.body.map((c: { nome: string }) => c.nome)).toEqual(['Pisos', 'Argamassas']);
  });

  it('loja sem integração recebe 409 explicando o que fazer', async () => {
    const semIntegracao = await registrar(false);
    const res = await produtos(semIntegracao.chaveAtendimento);
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('SEM_INTEGRACAO');
  });

  it('plataforma fora do ar vira 502', async () => {
    controleFalso.indisponivel = true;
    const res = await produtos(loja.chaveAtendimento);
    expect(res.status).toBe(502);
    expect(res.body.erro.codigo).toBe('PLATAFORMA_INDISPONIVEL');
  });

  it('busca as regras numa consulta só por página', async () => {
    const espiao = jest.spyOn(app.get(PrismaService).regraProduto, 'findMany');
    await produtos(loja.chaveAtendimento);
    expect(espiao).toHaveBeenCalledTimes(1);
    espiao.mockRestore();
  });

  describe('rotas de regras', () => {
    it('cria, lê, lista e apaga regra', async () => {
      const criada = await regra(loja.chaveAdmin, 'A1', { selo: 'Novo', rendimentoM2: 4, compreJunto: ['C3'] });
      expect(criada.status).toBe(200);
      expect(criada.body).toMatchObject({ sku: 'A1', oculto: false, selo: 'Novo', rendimentoM2: 4, compreJunto: ['C3'] });
      await regra(loja.chaveAdmin, 'A1', { oculto: true });
      const lida = await http().get('/v1/loja/regras/A1').set('X-Loja-Chave', loja.chaveAdmin);
      expect(lida.body).toMatchObject({ oculto: true, selo: 'Novo' });
      expect((await http().get('/v1/loja/regras').set('X-Loja-Chave', loja.chaveAdmin)).body).toHaveLength(1);
      expect((await http().delete('/v1/loja/regras/A1').set('X-Loja-Chave', loja.chaveAdmin)).status).toBe(204);
      expect((await http().get('/v1/loja/regras/A1').set('X-Loja-Chave', loja.chaveAdmin)).status).toBe(404);
    });

    it('valida os campos', async () => {
      expect((await regra(loja.chaveAdmin, 'A1', { selo: 'x'.repeat(31) })).status).toBe(400);
      expect((await regra(loja.chaveAdmin, 'A1', { m2PorUnidade: 0 })).status).toBe(400);
      expect((await regra(loja.chaveAdmin, 'A1', { compreJunto: Array.from({ length: 21 }, (_, i) => `S${i}`) })).status).toBe(400);
    });

    it('selo nulo limpa o selo', async () => {
      await regra(loja.chaveAdmin, 'A1', { selo: 'Novo' });
      expect((await regra(loja.chaveAdmin, 'A1', { selo: null })).body.selo).toBeNull();
    });

    it('chave de atendimento não altera regras', async () => {
      expect((await regra(loja.chaveAtendimento, 'A1', { oculto: true })).status).toBe(403);
    });

    it('regra de uma loja não afeta outra', async () => {
      await regra(loja.chaveAdmin, 'B2', { oculto: true });
      const outra = await registrar();
      expect((await produtos(outra.chaveAtendimento)).body.itens.map((p: { sku: string }) => p.sku)).toEqual(['A1', 'B2', 'C3']);
      expect((await http().get('/v1/loja/regras').set('X-Loja-Chave', outra.chaveAdmin)).body).toEqual([]);
    });
  });
});
