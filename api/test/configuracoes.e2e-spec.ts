import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

// PNG 1×1 válido.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('configurações da loja (admin): aparência, entrega, pedidos e catálogo', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  const http = () => request(app.getHttpServer());
  const patch = (corpo: object, chave = loja.chaveAdmin) => http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', chave).send(corpo);
  const ler = () => http().get('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin);

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lê os padrões e grava só o que veio (o tema é mesclado)', async () => {
    const antes = await ler();
    expect(antes.status).toBe(200);
    expect(antes.body).toMatchObject({ tema: { corPrimaria: '#7C3AED', layout: 'grade', destaque: true }, mostrarPrecos: true, expiracaoLinkDias: 7 });
    expect((await patch({ tema: { corPrimaria: '#0055AA', boasVindas: 'Bem-vindo!' } })).status).toBe(200);
    expect((await patch({ tema: { layout: 'lista' }, mostrarPrecos: false, expiracaoLinkDias: 3 })).status).toBe(200);
    const depois = (await ler()).body;
    expect(depois.tema).toMatchObject({ corPrimaria: '#0055AA', boasVindas: 'Bem-vindo!', layout: 'lista' });
    expect(depois).toMatchObject({ mostrarPrecos: false, expiracaoLinkDias: 3, entrega: { habilitada: true } });
  });

  it('só a chave de admin altera', async () => {
    expect((await patch({ mostrarPrecos: false }, loja.chaveAtendimento)).status).toBe(403);
    expect((await http().get('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAtendimento)).status).toBe(403);
  });

  it('valida cores (formato e contraste com o texto branco), layout, prazos e frete', async () => {
    expect((await patch({ tema: { corPrimaria: 'azul' } })).status).toBe(400);
    const clara = await patch({ tema: { corPrimaria: '#FFFF00' } });
    expect(clara.status).toBe(400);
    expect(clara.body.erro.mensagem).toBe('A cor principal é clara demais: o texto branco dos botões ficaria ilegível. Escolha um tom mais escuro.');
    expect((await patch({ tema: { corTopo: '#EEEEEE' } })).status).toBe(400);
    expect((await patch({ tema: { layout: 'mosaico' } })).status).toBe(400);
    expect((await patch({ expiracaoLinkDias: 0 })).status).toBe(400);
    expect((await patch({ expiracaoLinkDias: 61 })).status).toBe(400);
    expect((await patch({ frete: { regra: 'fixo' } })).status).toBe(400);
    expect((await patch({ frete: { regra: 'gratis_acima_de', valor: 20, minimo: -1 } })).status).toBe(400);
    expect((await patch({ frete: { regra: 'fixo', valor: 15.5, prazo: 'Até 2 dias' } })).status).toBe(200);
  });

  it('entrega, retirada e lojas de retirada (ids gerados quando faltam)', async () => {
    const res = await patch({
      entrega: { habilitada: false },
      retirada: { habilitada: true },
      lojasRetirada: [{ nome: 'Loja Centro', endereco: 'Rua B, 2', horario: '8h–18h', orientacoes: 'Balcão 3' }],
    });
    expect(res.status).toBe(200);
    const c = (await ler()).body;
    expect(c.entrega.habilitada).toBe(false);
    expect(c.lojasRetirada).toEqual([{ id: expect.stringMatching(/^[a-z0-9-]{1,40}$/), nome: 'Loja Centro', endereco: 'Rua B, 2', horario: '8h–18h', orientacoes: 'Balcão 3' }]);
    // Sem entrega e sem retirada o cliente não teria como finalizar.
    const nenhum = await patch({ entrega: { habilitada: false }, retirada: { habilitada: false } });
    expect(nenhum.status).toBe(400);
    expect(nenhum.body.erro.mensagem).toBe('Deixe ao menos uma forma de receber ligada: entrega ou retirada.');
    expect((await patch({ retirada: { habilitada: true }, lojasRetirada: [] })).status).toBe(400);
  });

  it('categorias ocultas', async () => {
    expect((await patch({ categoriasOcultas: ['2'] })).status).toBe(200);
    expect((await ler()).body.categoriasOcultas).toEqual(['2']);
  });

  it('filas do atendimento: grava sem repetir, o painel lê pelo GET /v1/loja, e vazio volta a valer para todas', async () => {
    const loja1 = () => http().get('/v1/loja').set('X-Loja-Chave', loja.chaveAtendimento);
    expect((await ler()).body.filasAtendimento).toEqual([]);
    expect((await loja1()).body.filasAtendimento).toEqual([]);

    expect((await patch({ filasAtendimento: [12, 3, 12] })).status).toBe(200);
    expect((await ler()).body.filasAtendimento).toEqual([3, 12]);
    expect((await loja1()).body.filasAtendimento).toEqual([3, 12]);

    expect((await patch({ mostrarPrecos: false })).status).toBe(200); // sem o campo, as filas ficam
    expect((await ler()).body.filasAtendimento).toEqual([3, 12]);
    expect((await patch({ filasAtendimento: [] })).status).toBe(200);
    expect((await loja1()).body.filasAtendimento).toEqual([]);

    for (const filasAtendimento of [[0], ['12'], [1.5]]) expect((await patch({ filasAtendimento })).status).toBe(400);
  });

  it('logo: envia, aparece no catálogo com cache longo, e pode ser removido', async () => {
    const envio = await http()
      .put('/v1/loja/logo')
      .set('X-Loja-Chave', loja.chaveAdmin)
      .send({ tipo: 'image/png', base64: PNG.toString('base64') });
    expect(envio.status).toBe(200);
    const url: string = envio.body.logoUrl;
    expect(url).toMatch(new RegExp(`^https://shop\\.teste/v1/publico/lojas/${loja.lojaId}/logo\\?v=[a-f0-9]{12}$`));

    const token = await gerarLink(app, loja);
    const aberto = await http().get(`/v1/catalogo/${token}/abrir`).set('X-Forwarded-For', '10.150.0.1');
    expect(aberto.body.tema.logoUrl).toBe(url);

    const imagem = await http().get(url.replace('https://shop.teste', ''));
    expect(imagem.status).toBe(200);
    expect(imagem.headers['content-type']).toBe('image/png');
    expect(imagem.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(imagem.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(imagem.body as Buffer, PNG)).toBe(0);

    expect((await http().delete('/v1/loja/logo').set('X-Loja-Chave', loja.chaveAdmin)).status).toBe(200);
    expect((await ler()).body.tema.logoUrl).toBeUndefined();
    expect((await http().get(url.replace('https://shop.teste', ''))).status).toBe(404);
  });

  it('logo: recusa tipo errado, conteúdo que não bate com o tipo e arquivo grande', async () => {
    const enviar = (corpo: object) => http().put('/v1/loja/logo').set('X-Loja-Chave', loja.chaveAdmin).send(corpo);
    expect((await enviar({ tipo: 'image/svg+xml', base64: PNG.toString('base64') })).status).toBe(400);
    const falso = await enviar({ tipo: 'image/png', base64: Buffer.from('<script>alert(1)</script>').toString('base64') });
    expect(falso.status).toBe(400);
    expect(falso.body.erro.mensagem).toBe('O arquivo não é uma imagem PNG, JPG ou WebP válida.');
    const grande = Buffer.concat([PNG, Buffer.alloc(310 * 1024)]);
    const res = await enviar({ tipo: 'image/png', base64: grande.toString('base64') });
    expect(res.status).toBe(400);
    expect(res.body.erro.mensagem).toBe('O logo pode ter até 300 KB.');
  });
});
