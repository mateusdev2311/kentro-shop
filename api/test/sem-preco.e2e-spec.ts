import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { controleFalso, reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
const ENTREGA = { nome: 'Ana', telefone: '38988887777', cep: '39400000', estado: 'MG', cidade: 'MOC', bairro: 'Centro', rua: 'Rua A', numero: '1' };

describe('catálogo sem preço', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let ipSeq = 0;
  let ip = '';
  const pub = (metodo: 'get' | 'put' | 'post', url: string) => request(app.getHttpServer())[metodo](url).set('X-Forwarded-For', ip);
  const semPrecoNaLoja = () => prisma.configLoja.create({ data: { lojaId: loja.lojaId, mostrarPrecos: false } });

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.140.0.${ipSeq}`;
    reiniciarFalso();
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    reiniciarFalso();
    await app.close();
    await prisma.$disconnect();
  });

  it('loja sem preço: nenhuma rota pública devolve preço; o atendente continua vendo', async () => {
    await semPrecoNaLoja();
    const t = await gerarLink(app, loja);
    const aberto = await pub('get', `/v1/catalogo/${t}/abrir`);
    expect(aberto.body.mostrarPrecos).toBe(false);
    expect(aberto.body.frete).toEqual({ regra: 'a_combinar' });

    const lista = await pub('get', `/v1/catalogo/${t}/produtos`);
    const texto = JSON.stringify(lista.body);
    expect(texto).not.toContain('129.9');
    expect(texto).not.toContain('precoDe');
    const c3 = lista.body.itens.find((p: { id: string }) => p.id === 'id-C3');
    expect(c3.variacoes.every((v: { preco: number }) => v.preco === 0)).toBe(true);
    expect((await pub('get', `/v1/catalogo/${t}/produtos/id-A1`)).body).toMatchObject({ preco: 0, disponivel: true });

    const carrinho = await pub('put', `/v1/catalogo/${t}/carrinho`).send({ itens: [{ produtoId: 'id-A1', quantidade: 2 }] });
    expect(carrinho.body.sessao.itens[0]).toMatchObject({ precoUnitario: 0, subtotal: 0, quantidade: 2 });
    expect(carrinho.body.sessao.totais).toEqual({ itens: 2, subtotal: 0, frete: null, desconto: 0, total: 0 });
    expect((await pub('post', `/v1/catalogo/${t}/frete`).send({ cep: '39400000' })).body).toEqual({ titulo: 'Frete a combinar', valor: null });

    const fim = await pub('post', `/v1/catalogo/${t}/finalizar`).send({ tipo: 'entrega', entrega: ENTREGA });
    expect(fim.status).toBe(200);
    expect(fim.body.totais.total).toBe(0);
    const painel = await request(app.getHttpServer()).get('/v1/sessoes/chat/100').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(painel.body.totais.total).toBe(259.8);
    expect(painel.body.resumo).toContain('R$ 259,80');
  });

  it('o link manda: sem preço numa loja com preço e com preço numa loja sem preço', async () => {
    const t1 = await gerarLink(app, loja, '100', { mostrarPrecos: false });
    expect((await pub('get', `/v1/catalogo/${t1}/abrir`)).body.mostrarPrecos).toBe(false);
    expect((await pub('get', `/v1/catalogo/${t1}/produtos/id-A1`)).body.preco).toBe(0);
    await semPrecoNaLoja();
    const t2 = await gerarLink(app, loja, '200', { mostrarPrecos: true });
    expect((await pub('get', `/v1/catalogo/${t2}/abrir`)).body.mostrarPrecos).toBe(true);
    expect((await pub('get', `/v1/catalogo/${t2}/produtos/id-A1`)).body.preco).toBe(129.9);
  });

  it('sem preço, preço que mudou não interrompe o cliente (o carrinho é atualizado em silêncio)', async () => {
    await semPrecoNaLoja();
    const t = await gerarLink(app, loja);
    await pub('put', `/v1/catalogo/${t}/carrinho`).send({ itens: [{ produtoId: 'id-A1', quantidade: 2 }] });
    controleFalso.precos.A1 = 139.9;
    expect((await pub('post', `/v1/catalogo/${t}/finalizar`).send({ tipo: 'entrega', entrega: ENTREGA })).status).toBe(200);
    const painel = await request(app.getHttpServer()).get('/v1/sessoes/chat/100').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(painel.body.itens[0].precoUnitario).toBe(139.9);
    expect(painel.body.totais.total).toBe(279.8);
  });

  it('sem preço, produto que sumiu ainda avisa (409), mas a diferença não traz preço', async () => {
    await semPrecoNaLoja();
    const t = await gerarLink(app, loja);
    await pub('put', `/v1/catalogo/${t}/carrinho`).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }, { produtoId: 'id-B2', quantidade: 1 }] });
    controleFalso.removidos = ['A1'];
    const res = await pub('post', `/v1/catalogo/${t}/finalizar`).send({ tipo: 'entrega', entrega: ENTREGA });
    expect(res.status).toBe(409);
    expect(res.body.diferencas).toEqual([{ sku: 'A1', nome: 'Produto A1', antes: { quantidade: 1 }, depois: null }]);
    expect(res.body.sessao.itens.map((i: { precoUnitario: number }) => i.precoUnitario)).toEqual([0]);
    expect(res.body.sessao.totais.total).toBe(0);
  });
});
