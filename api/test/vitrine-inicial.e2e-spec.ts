import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { controleFalso, PRODUTOS_FALSOS, reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
const ids = (lista: { id: string }[]) => lista.map((p) => p.id);

describe('vitrine da página inicial', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let ipSeq = 0;
  let ip = '';
  const pub = (url: string) => request(app.getHttpServer()).get(url).set('X-Forwarded-For', ip);
  const salvar = (corpo: object) => request(app.getHttpServer()).patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send(corpo);

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.141.0.${ipSeq}`;
    reiniciarFalso();
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    reiniciarFalso();
    await app.close();
    await prisma.$disconnect();
  });

  it('sem produtos escolhidos: a área não existe e o tema continua sem os campos', async () => {
    const t = await gerarLink(app, loja);
    expect((await pub(`/v1/catalogo/${t}/vitrine-inicial`)).body).toEqual([]);
    const { tema } = (await pub(`/v1/catalogo/${t}/abrir`)).body;
    expect(tema).not.toHaveProperty('vitrineProdutos');
    expect(tema).not.toHaveProperty('vitrineTitulo');
  });

  it('devolve na ordem da loja; o que não existe, sumiu ou está em categoria oculta fica de fora', async () => {
    const salvo = await salvar({ tema: { vitrineTitulo: ' Campeões ', vitrineProdutos: ['id-C3', 'id-A1', 'nao-existe', 'id-A1', 'id-B2'] } });
    expect(salvo.status).toBe(200);
    expect(salvo.body.tema).toMatchObject({ vitrineTitulo: 'Campeões', vitrineProdutos: ['id-C3', 'id-A1', 'nao-existe', 'id-B2'] }); // sem repetir

    const t = await gerarLink(app, loja);
    expect((await pub(`/v1/catalogo/${t}/abrir`)).body.tema.vitrineTitulo).toBe('Campeões');
    expect(ids((await pub(`/v1/catalogo/${t}/vitrine-inicial`)).body)).toEqual(['id-C3', 'id-A1', 'id-B2']);

    await salvar({ categoriasOcultas: ['2'] });
    expect(ids((await pub(`/v1/catalogo/${t}/vitrine-inicial`)).body)).toEqual(['id-C3', 'id-A1']);
  });

  it('produto sem estoque sai da área', async () => {
    const b2 = PRODUTOS_FALSOS.find((p) => p.id === 'id-B2')!;
    const estoque = b2.estoque;
    b2.estoque = 0;
    try {
      await salvar({ tema: { vitrineProdutos: ['id-B2', 'id-A1'] } });
      const t = await gerarLink(app, loja);
      expect(ids((await pub(`/v1/catalogo/${t}/vitrine-inicial`)).body)).toEqual(['id-A1']);
    } finally {
      b2.estoque = estoque;
    }
  });

  it('plataforma fora do ar: lista vazia, sem erro na página inicial', async () => {
    await salvar({ tema: { vitrineProdutos: ['id-A1'] } });
    const t = await gerarLink(app, loja);
    controleFalso.indisponivel = true;
    const r = await pub(`/v1/catalogo/${t}/vitrine-inicial`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('catálogo sem preço: a área também não mostra valores', async () => {
    await salvar({ mostrarPrecos: false, tema: { vitrineProdutos: ['id-A1'] } });
    const t = await gerarLink(app, loja);
    const texto = JSON.stringify((await pub(`/v1/catalogo/${t}/vitrine-inicial`)).body);
    expect(texto).toContain('id-A1');
    expect(texto).not.toContain('129.9');
    expect(texto).not.toContain('precoDe');
  });

  it('valida o limite de 12 produtos; lista e título vazios limpam a área', async () => {
    const treze = Array.from({ length: 13 }, (_, i) => `p${i}`);
    expect((await salvar({ tema: { vitrineProdutos: treze } })).status).toBe(400);
    expect((await salvar({ tema: { vitrineTitulo: 'x'.repeat(61) } })).status).toBe(400);
    expect((await salvar({ tema: { vitrineProdutos: treze.slice(0, 12), vitrineTitulo: 'Campeões' } })).status).toBe(200);

    const limpo = await salvar({ tema: { vitrineProdutos: [], vitrineTitulo: '' } });
    expect(limpo.body.tema).not.toHaveProperty('vitrineProdutos');
    expect(limpo.body.tema).not.toHaveProperty('vitrineTitulo');
  });

  it('o admin lê os escolhidos pelo id, na ordem, e sem os que não existem', async () => {
    const pedir = (q: string) => request(app.getHttpServer()).get(`/v1/loja/catalogo/produtos-por-id${q}`).set('X-Loja-Chave', loja.chaveAdmin);
    expect(ids((await pedir('?ids=id-B2,nao-existe,id-A1')).body)).toEqual(['id-B2', 'id-A1']);
    expect((await pedir('')).body).toEqual([]);
    expect((await request(app.getHttpServer()).get('/v1/loja/catalogo/produtos-por-id?ids=id-A1')).status).toBe(401);
  });
});
