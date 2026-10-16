import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { controleFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

describe('carrinho e catálogo do cliente (rotas públicas)', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let token: string;
  // Cada teste sai de um IP diferente: o limite de 120/min por IP vale para o app inteiro.
  let ip = '10.100.0.0';
  let ipSeq = 0;
  const http = () => {
    const agente = request(app.getHttpServer());
    const comIp = (r: request.Test) => r.set('X-Forwarded-For', ip);
    return {
      get: (url: string) => comIp(agente.get(url)),
      put: (url: string) => comIp(agente.put(url)),
    };
  };
  const carrinho = (itens: object[], t = token) => http().put(`/v1/catalogo/${t}/carrinho`).send({ itens });

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.100.0.${ipSeq}`;
    controleFalso.indisponivel = false;
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
    token = await gerarLink(app, loja);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('abrir devolve a sessão pública, o tema e as opções de entrega', async () => {
    const res = await http().get(`/v1/catalogo/${token}/abrir`);
    expect(res.status).toBe(200);
    expect(res.body.sessao).toMatchObject({ status: 'navegando', cliente: { nome: 'Ana Souza' }, itens: [] });
    expect(res.body.sessao.eventos).toBeUndefined();
    expect(res.body.sessao.resumo).toBeUndefined();
    expect(res.body.tema).toEqual({ nome: 'Loja Teste', corPrimaria: '#7C3AED' });
    expect(res.body.entrega).toEqual({ habilitada: true });
    expect(res.body.retirada).toEqual({ habilitada: false, lojas: [] });
    expect(res.body.frete).toEqual({ regra: 'a_combinar' });
  });

  it('link inválido responde 404 com a mensagem amigável', async () => {
    const res = await http().get('/v1/catalogo/nao-existe/abrir');
    expect(res.status).toBe(404);
    expect(res.body.erro).toEqual({ codigo: 'LINK_INVALIDO', mensagem: 'Este link não está mais disponível. Peça um novo link no WhatsApp.' });
  });

  it('lista categorias e produtos da loja do link', async () => {
    expect((await http().get(`/v1/catalogo/${token}/categorias`)).body.map((c: { id: string }) => c.id)).toEqual(['1', '2']);
    const produtos = await http().get(`/v1/catalogo/${token}/produtos?busca=a1`);
    expect(produtos.body.itens.map((p: { sku: string }) => p.sku)).toEqual(['A1']);
    expect((await http().get(`/v1/catalogo/${token}/produtos/id-C3`)).body.variacoes).toHaveLength(2);
  });

  it('esconde categorias ocultas e os produtos que só estão nelas', async () => {
    await prisma.configLoja.create({ data: { lojaId: loja.lojaId, categoriasOcultas: ['2'] } });
    expect((await http().get(`/v1/catalogo/${token}/categorias`)).body.map((c: { id: string }) => c.id)).toEqual(['1']);
    const skus = (await http().get(`/v1/catalogo/${token}/produtos`)).body.itens.map((p: { sku: string }) => p.sku);
    expect(skus).toEqual(['A1', 'C3']);
  });

  it('grava o preço do conector, não o do navegador', async () => {
    const res = await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    expect(res.status).toBe(200);
    expect(res.body.avisos).toEqual([]);
    expect(res.body.sessao.itens).toEqual([
      expect.objectContaining({ produtoId: 'id-A1', variacaoId: null, sku: 'A1', precoUnitario: 129.9, quantidade: 2, subtotal: 259.8 }),
    ]);
    expect(res.body.sessao.totais).toEqual({ itens: 2, subtotal: 259.8, frete: null, desconto: 0, total: 259.8 });
    const tentativa = await carrinho([{ produtoId: 'id-A1', quantidade: 1, preco: 0.01 }]);
    expect(tentativa.status).toBe(400);
  });

  it('variação: grava a escolhida, recusa a inexistente e a indisponível', async () => {
    const res = await carrinho([
      { produtoId: 'id-C3', variacaoId: 'v1', quantidade: 1 },
      { produtoId: 'id-C3', variacaoId: 'v9', quantidade: 1 },
      { produtoId: 'id-C3', variacaoId: 'v2', quantidade: 1 },
      { produtoId: 'id-C3', quantidade: 1 },
    ]);
    expect(res.body.sessao.itens.map((i: { sku: string; variacaoNome: string }) => [i.sku, i.variacaoNome])).toEqual([['C3-AZ', 'Azul']]);
    expect(res.body.avisos).toEqual([
      'A opção escolhida de Produto C3 não existe mais.',
      'Produto C3 (Verde) não está mais disponível.',
      'Escolha a opção de Produto C3.',
    ]);
  });

  it('limita ao estoque e avisa', async () => {
    const res = await carrinho([{ produtoId: 'id-A1', quantidade: 9 }]);
    expect(res.body.sessao.itens[0].quantidade).toBe(5);
    expect(res.body.avisos).toEqual(['Só temos 5 unidades de Produto A1.']);
  });

  it('produto que sumiu da loja sai do carrinho com aviso', async () => {
    const res = await carrinho([{ produtoId: 'id-ZZ', quantidade: 1 }]);
    expect(res.body.sessao.itens).toEqual([]);
    expect(res.body.avisos).toEqual(['Um produto do carrinho não está mais disponível.']);
  });

  it('registra adicionar, alterar e remover na atividade', async () => {
    await http().get(`/v1/catalogo/${token}/abrir`);
    await carrinho([{ produtoId: 'id-A1', quantidade: 1 }]);
    await carrinho([{ produtoId: 'id-A1', quantidade: 3 }, { produtoId: 'id-B2', quantidade: 1 }]);
    await carrinho([{ produtoId: 'id-B2', quantidade: 1 }]);
    const textos = (await prisma.eventoSessao.findMany({ where: { autor: 'cliente' }, orderBy: { em: 'asc' } })).map((e) => e.texto);
    expect(textos).toEqual([
      'Cliente abriu o catálogo',
      'Adicionou 1 unidade de Produto A1',
      'Alterou Produto A1: 1 → 3',
      'Adicionou 1 unidade de Produto B2',
      'Removeu Produto A1',
    ]);
  });

  it('plataforma fora do ar: 502 e o carrinho gravado continua intacto', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    controleFalso.indisponivel = true;
    const res = await carrinho([{ produtoId: 'id-A1', quantidade: 3 }]);
    expect(res.status).toBe(502);
    expect(res.body.erro.codigo).toBe('PLATAFORMA_INDISPONIVEL');
    controleFalso.indisponivel = false;
    const sessao = (await http().get(`/v1/catalogo/${token}/abrir`)).body.sessao;
    expect(sessao.itens[0].quantidade).toBe(2);
  });

  it('item sem mudança não é consultado de novo na plataforma', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    controleFalso.indisponivel = true;
    const res = await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    expect(res.status).toBe(200);
  });

  it('pedido já enviado não aceita mais alterações', async () => {
    await prisma.sessao.updateMany({ data: { status: 'finalizado', finalizadaEm: new Date() } });
    const res = await carrinho([{ produtoId: 'id-A1', quantidade: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('PEDIDO_JA_ENVIADO');
  });

  it('cada link usa a integração da própria loja', async () => {
    const semIntegracao = await lojaIntegrada(app, false);
    const outroToken = await gerarLink(app, semIntegracao, '200');
    const res = await http().get(`/v1/catalogo/${outroToken}/produtos`);
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('SEM_INTEGRACAO');
  });

  it('limita as rotas públicas a 120 por minuto por IP', async () => {
    let ultimo = 200;
    for (let i = 0; i < 121; i++) {
      ultimo = (await request(app.getHttpServer()).get(`/v1/catalogo/${token}/abrir`).set('X-Forwarded-For', '10.200.0.1')).status;
    }
    expect(ultimo).toBe(429);
  });
});
