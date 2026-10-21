import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (tamanho = 64, marca = 1) => Buffer.concat([ASSINATURA_PNG, Buffer.alloc(tamanho, marca)]).toString('base64');

describe('aparência: banners do carrossel e personalização', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  const http = () => request(app.getHttpServer());
  const admin = (metodo: 'post' | 'put' | 'patch' | 'delete', url: string, chave = loja.chaveAdmin) => http()[metodo](url).set('X-Loja-Chave', chave);
  const novo = (marca = 1, extra: object = {}) => admin('post', '/v1/loja/banners').send({ tipo: 'image/png', base64: png(64, marca), ...extra });

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    reiniciarFalso();
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('adiciona, serve a imagem com cache longo e o catálogo do cliente recebe os banners', async () => {
    const res = await novo(1, { titulo: ' Coleção de verão ', categoriaId: '2' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      { id: expect.any(String), url: expect.stringMatching(/^https:\/\/shop\.teste\/v1\/publico\/lojas\/.+\/banners\/.+\?v=[0-9a-f]{12}$/), titulo: 'Coleção de verão', categoriaId: '2' },
    ]);
    const caminho = new URL(res.body[0].url).pathname;
    const imagem = await http().get(caminho).buffer(true);
    expect(imagem.status).toBe(200);
    expect(imagem.headers['content-type']).toBe('image/png');
    expect(imagem.headers['cache-control']).toContain('immutable');

    const token = await gerarLink(app, loja);
    const aberto = await http().get(`/v1/catalogo/${token}/abrir`).set('X-Forwarded-For', '10.150.0.1');
    expect(aberto.body.tema.banners).toEqual(res.body);
    expect(aberto.body.tema).toMatchObject({ fonte: 'classica', cantos: 'arredondados', imagemProduto: 'quadrada', bannerSegundos: 5 });
  });

  it('edita a ação (categoria vence a busca), reordena e remove', async () => {
    const [a] = (await novo(1)).body;
    const lista = (await novo(2)).body;
    const b = lista[1];
    const editado = await admin('patch', `/v1/loja/banners/${a.id}`).send({ titulo: 'Polos', categoriaId: '', busca: 'polo' });
    expect(editado.body[0]).toMatchObject({ titulo: 'Polos', busca: 'polo' });
    expect(editado.body[0].categoriaId).toBeUndefined();
    const ambos = await admin('patch', `/v1/loja/banners/${a.id}`).send({ categoriaId: '1', busca: 'polo' });
    expect(ambos.body[0]).toMatchObject({ categoriaId: '1' });
    expect(ambos.body[0].busca).toBeUndefined();

    const ordem = await admin('put', '/v1/loja/banners/ordem').send({ ids: [b.id, a.id] });
    expect(ordem.body.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
    expect((await admin('put', '/v1/loja/banners/ordem').send({ ids: [b.id] })).status).toBe(400);

    const removido = await admin('delete', `/v1/loja/banners/${b.id}`);
    expect(removido.body.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });

  it('recusa arquivo que não é imagem, banner grande demais e o sétimo banner', async () => {
    expect((await admin('post', '/v1/loja/banners').send({ tipo: 'image/png', base64: Buffer.from('não sou png').toString('base64') })).status).toBe(400);
    const grande = await admin('post', '/v1/loja/banners').send({ tipo: 'image/png', base64: png(401 * 1024) });
    expect(grande.status).toBe(400);
    expect(grande.body.erro.mensagem).toContain('400 KB');
    for (let i = 0; i < 6; i++) expect((await novo(i + 1)).status).toBe(201);
    const setimo = await novo(9);
    expect(setimo.status).toBe(400);
    expect(setimo.body.erro.mensagem).toContain('até 6 banners');
  });

  it('só a chave de admin da própria loja mexe nos banners', async () => {
    const [a] = (await novo()).body;
    expect((await novo(1).set('X-Loja-Chave', loja.chaveAtendimento)).status).toBe(403);
    const outra = await lojaIntegrada(app);
    expect((await admin('patch', `/v1/loja/banners/${a.id}`, outra.chaveAdmin).send({ titulo: 'x' })).status).toBe(404);
    await admin('delete', `/v1/loja/banners/${a.id}`, outra.chaveAdmin);
    const minha = await http().get('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin);
    expect(minha.body.tema.banners).toHaveLength(1);
  });

  it('salva letra, cantos, foto, título da faixa, "Compre também" e o tempo do banner; recusa valores fora da lista', async () => {
    const ok = await admin('patch', '/v1/loja/configuracoes').send({
      tema: { fonte: 'elegante', cantos: 'retos', imagemProduto: 'retrato', tituloDestaque: ' Moda masculina ', compreTambem: false, bannerSegundos: 7 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.tema).toMatchObject({ fonte: 'elegante', cantos: 'retos', imagemProduto: 'retrato', tituloDestaque: 'Moda masculina', compreTambem: false, bannerSegundos: 7 });
    expect((await admin('patch', '/v1/loja/configuracoes').send({ tema: { fonte: 'comic-sans' } })).status).toBe(400);
    expect((await admin('patch', '/v1/loja/configuracoes').send({ tema: { bannerSegundos: 60 } })).status).toBe(400);
    // "Compre também" desligado: o catálogo não recebe sugestões.
    const token = await gerarLink(app, loja, '200', { filtro: { produtoIds: ['id-A1'] } });
    expect((await http().get(`/v1/catalogo/${token}/sugestoes`).set('X-Forwarded-For', '10.150.0.2')).body).toEqual([]);
  });
});
