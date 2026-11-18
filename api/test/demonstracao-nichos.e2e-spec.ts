import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { conectorDemonstracao } from '../src/conectores/demonstracao/demonstracao.conector';
import { criarAppDeTeste } from './app';
import { conectorFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

// Demonstração por ramo de loja: o atendente gera o link de um ramo (farmácia, pet shop...) e o cliente vê o
// catálogo e a aparência da loja fictícia daquele ramo, com imagens servidas pela própria API.

const prisma = new PrismaClient();
let ipSeq = 0;

interface Loja {
  lojaId: string;
  chaveAdmin: string;
  chaveAtendimento: string;
}

describe('demonstração por ramo de loja', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  async function registrar(plataforma: 'demonstracao' | 'falso', credenciais: Record<string, string>): Promise<Loja> {
    ipSeq += 1;
    const loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.9.0.${ipSeq}`).send({ nome: 'Loja Demo' })).body;
    const r = await http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma, credenciais });
    expect(r.status).toBeLessThan(300);
    return loja;
  }
  const demo = (nicho?: string) => registrar('demonstracao', { codigo: 'demo', ...(nicho ? { nicho } : {}) });
  const link = (loja: Loja, corpo: object = {}) => http().post('/v1/sessoes').set('X-Loja-Chave', loja.chaveAtendimento).send({ chatId: '100', nome: 'Ana', ...corpo });
  const token = (url: string) => url.split('/c/')[1];

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { conectores: [conectorDemonstracao, conectorFalso] });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('o painel recebe os ramos e o padrão da loja; fora da demonstração, nenhum', async () => {
    const loja = await demo('petshop');
    const r = await http().get('/v1/sessoes/demonstracao').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(r.status).toBe(200);
    expect(r.body.padrao).toBe('petshop');
    expect(r.body.ramos.map((n: { id: string }) => n.id)).toEqual(['revestimentos', 'farmacia', 'petshop', 'mercado']);
    expect(r.body.ramos[1]).toEqual({ id: 'farmacia', nome: 'Farmácia', loja: 'Drogaria Modelo' });

    const outra = await registrar('falso', { url_api: 'https://api.teste', token: 'certo' });
    expect((await http().get('/v1/sessoes/demonstracao').set('X-Loja-Chave', outra.chaveAtendimento)).body).toEqual({ padrao: null, ramos: [] });
  });

  it('ramo padrão inválido na integração é recusado', async () => {
    ipSeq += 1;
    const loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.9.1.${ipSeq}`).send({ nome: 'X' })).body;
    const r = await http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma: 'demonstracao', credenciais: { codigo: 'demo', nicho: 'oficina' } });
    expect(r.status).toBe(400);
    expect(r.body.erro.mensagem).toMatch(/Ramo padrão/);
  });

  it('link da farmácia: o cliente vê as categorias, os produtos, a vitrine e a aparência da farmácia', async () => {
    const loja = await demo();
    const criado = await link(loja, { nicho: 'farmacia' });
    expect(criado.status).toBe(201);
    expect(criado.body.nicho).toBe('farmacia');
    const t = token(criado.body.url);

    const abertura = (await http().get(`/v1/catalogo/${t}/abrir`)).body;
    expect(abertura.tema).toMatchObject({ nome: 'Drogaria Modelo', corPrimaria: '#0f8b7e', vitrineTitulo: 'Mais procurados' });
    expect(abertura.tema.banners[0]).toEqual({ id: 'demo-farmacia-1', url: '/demo/banners/farmacia-1.svg', categoriaId: 'far-vit' });

    const categorias = (await http().get(`/v1/catalogo/${t}/categorias`)).body;
    expect(categorias.map((c: { id: string }) => c.id)).toContain('far-med');

    const produtos = (await http().get(`/v1/catalogo/${t}/produtos`)).body;
    expect(produtos.itens.every((p: { sku: string }) => p.sku.startsWith('FAR-'))).toBe(true);
    expect(produtos.itens[0].imagens[0]).toBe('https://shop.teste/demo/imagens/FAR-DIP-500.svg');

    const vitrine = (await http().get(`/v1/catalogo/${t}/vitrine-inicial`)).body;
    expect(vitrine.map((p: { sku: string }) => p.sku)).toEqual(['FAR-DIP-500', 'FAR-PSF-50', 'FAR-VTC-1G', 'FAR-FRD-PCT']);

    // O carrinho aceita os produtos do ramo.
    const carrinho = await http().put(`/v1/catalogo/${t}/carrinho`).send({ itens: [{ produtoId: 'FAR-DIP-500', quantidade: 2 }] });
    expect(carrinho.status).toBe(200);
    expect(carrinho.body.sessao.itens[0]).toMatchObject({ sku: 'FAR-DIP-500', quantidade: 2 });
  });

  it('link sem ramo segue a loja: catálogo do ramo padrão e o tema da própria loja', async () => {
    const loja = await demo('mercado');
    const t = token((await link(loja)).body.url);
    const abertura = (await http().get(`/v1/catalogo/${t}/abrir`)).body;
    expect(abertura.tema.nome).not.toBe('Mercadinho Modelo');
    const produtos = (await http().get(`/v1/catalogo/${t}/produtos`)).body;
    expect(produtos.itens.every((p: { sku: string }) => p.sku.startsWith('MER-'))).toBe(true);
  });

  it('gerar o link de outro ramo no mesmo atendimento troca a vitrine e o link anterior continua no ramo dele', async () => {
    const loja = await demo();
    const primeiro = token((await link(loja, { nicho: 'petshop' })).body.url);
    const segundo = await link(loja, { nicho: 'mercado' });
    expect(segundo.status).toBe(201);
    const t2 = token(segundo.body.url);
    expect(t2).not.toBe(primeiro);

    const lista = async (t: string) => (await http().get(`/v1/catalogo/${t}/produtos`)).body.itens.map((p: { sku: string }) => p.sku.slice(0, 3));
    expect(new Set(await lista(t2))).toEqual(new Set(['MER']));
    expect(new Set(await lista(primeiro))).toEqual(new Set(['PET']));
    expect((await http().get(`/v1/catalogo/${primeiro}/abrir`)).body.tema.nome).toBe('Pet Modelo');
  });

  it('o painel monta o link pelo catálogo do ramo escolhido', async () => {
    const loja = await demo();
    const r = await http().get('/v1/loja/catalogo/produtos?nicho=petshop&busca=bolinha').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(r.body.itens.map((p: { sku: string }) => p.sku)).toEqual(['PET-BOL-BOR']);
    const cats = await http().get('/v1/loja/catalogo/categorias?nicho=mercado').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(cats.body.map((c: { id: string }) => c.id)).toContain('mer-hort');
    // Ramo desconhecido na URL é ignorado (fica o padrão da loja).
    const padrao = await http().get('/v1/loja/catalogo/categorias?nicho=oficina').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(padrao.body.map((c: { id: string }) => c.id)).toContain('1');
  });

  it('ramo no link só vale na demonstração e precisa ser conhecido', async () => {
    const outra = await registrar('falso', { url_api: 'https://api.teste', token: 'certo' });
    const r = await link(outra, { nicho: 'farmacia' });
    expect(r.status).toBe(400);
    expect(r.body.erro.codigo).toBe('SO_NA_DEMONSTRACAO');

    const loja = await demo();
    expect((await link(loja, { nicho: 'oficina' })).status).toBe(400);
  });

  it('serve as imagens e os banners como SVG público, com cache; o resto é 404', async () => {
    const img = await http().get('/demo/imagens/FAR-DIP-500.svg');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(img.headers['access-control-allow-origin']).toBe('*');
    expect(img.headers['cache-control']).toMatch(/max-age=86400/);
    expect(String(img.body ?? img.text)).toMatch(/Dipirona/);

    expect((await http().get('/demo/imagens/PET-BOL-BOR~PET-BOL-BOR-AZL.svg')).status).toBe(200);
    expect((await http().get('/demo/banners/petshop-2.svg')).status).toBe(200);
    expect((await http().get('/demo/imagens/NAO-EXISTE.svg')).status).toBe(404);
    expect((await http().get('/demo/banners/petshop-9.svg')).status).toBe(404);
  });
});
