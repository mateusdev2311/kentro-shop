import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { controleFalso, reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

const ENTREGA = {
  nome: 'Ana Souza',
  telefone: '(38) 98888-7777',
  cep: '39400000',
  estado: 'mg',
  cidade: 'Montes Claros',
  bairro: 'Centro',
  rua: 'Rua A',
  numero: '10',
  complemento: '',
  referencia: 'Perto da praça',
};

describe('finalização do pedido', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let token: string;
  let ipSeq = 0;
  let ip = '';
  const http = () => {
    const agente = request(app.getHttpServer());
    return {
      put: (url: string) => agente.put(url).set('X-Forwarded-For', ip),
      post: (url: string) => agente.post(url).set('X-Forwarded-For', ip),
      get: (url: string) => agente.get(url).set('X-Forwarded-For', ip),
    };
  };
  const carrinho = (itens: object[]) => http().put(`/v1/catalogo/${token}/carrinho`).send({ itens });
  const finalizar = (corpo: object) => http().post(`/v1/catalogo/${token}/finalizar`).send(corpo);
  const configurar = (dados: object) => prisma.configLoja.upsert({ where: { lojaId: loja.lojaId }, create: { lojaId: loja.lojaId, ...dados }, update: dados });

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.110.0.${ipSeq}`;
    reiniciarFalso();
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
    token = await gerarLink(app, loja);
  });
  afterAll(async () => {
    reiniciarFalso();
    await app.close();
    await prisma.$disconnect();
  });

  it('finaliza com entrega: grava o endereço, o cliente e o resumo', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    const res = await finalizar({ tipo: 'entrega', entrega: ENTREGA, observacoes: ' Entregar sábado ' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('finalizado');
    expect(res.body.checkout).toMatchObject({ tipo: 'entrega', entrega: { cep: '39400-000', estado: 'MG' }, observacoes: 'Entregar sábado' });
    expect(res.body.cliente).toEqual({ nome: 'Ana Souza', telefone: '(38) 98888-7777' });
    expect(res.body.totais).toEqual({ itens: 2, subtotal: 259.8, frete: null, desconto: 0, total: 259.8 });

    const painel = await request(app.getHttpServer()).get('/v1/sessoes/chat/100').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(painel.body.resumo).toContain('Tipo: Entrega');
    expect(painel.body.resumo).toContain('Frete: a combinar');
    expect(painel.body.eventos[0].texto).toBe('Cliente finalizou o pedido (entrega) — R$ 259,80');
  });

  it('diz o que falta no endereço', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 1 }]);
    const res = await finalizar({ tipo: 'entrega', entrega: { ...ENTREGA, cep: '123', numero: '' } });
    expect(res.status).toBe(400);
    expect(res.body.erro.mensagem).toBe('Preencha: CEP, Número.');
  });

  it('carrinho vazio não finaliza', async () => {
    const res = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(res.status).toBe(400);
    expect(res.body.erro.mensagem).toBe('O carrinho está vazio.');
  });

  it('retirada só quando a loja oferece, e numa loja que existe', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 1 }]);
    expect((await finalizar({ tipo: 'retirada', lojaRetiradaId: 'centro' })).body.erro.mensagem).toBe('Esta loja não faz retirada.');
    await configurar({
      retirada: { habilitada: true },
      lojasRetirada: [{ id: 'centro', nome: 'Loja Centro', endereco: 'Rua B, 2', horario: '8h-18h', orientacoes: 'Balcão' }],
    });
    expect((await finalizar({ tipo: 'retirada', lojaRetiradaId: 'xx' })).body.erro.mensagem).toBe('Escolha uma das lojas para retirada.');
    const ok = await finalizar({ tipo: 'retirada', lojaRetiradaId: 'centro' });
    expect(ok.status).toBe(200);
    expect(ok.body.checkout).toMatchObject({ tipo: 'retirada', loja: { nome: 'Loja Centro' } });
    expect(ok.body.totais.frete).toBe(0);
  });

  it('preço mudou: 409 com a diferença, carrinho atualizado e finalização ao confirmar', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    controleFalso.precos.A1 = 139.9;
    const res = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('PRECOS_ALTERADOS');
    expect(res.body.diferencas).toEqual([
      { sku: 'A1', nome: 'Produto A1', antes: { preco: 129.9, quantidade: 2 }, depois: { preco: 139.9, quantidade: 2 } },
    ]);
    expect(res.body.sessao.itens[0].precoUnitario).toBe(139.9);
    expect(res.body.sessao.status).toBe('navegando');
    const confirmado = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(confirmado.status).toBe(200);
    expect(confirmado.body.totais.subtotal).toBe(279.8);
  });

  it('produto sumiu: diferença sem "depois" e ele sai do carrinho', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 1 }, { produtoId: 'id-B2', quantidade: 1 }]);
    controleFalso.removidos = ['A1'];
    const res = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(res.status).toBe(409);
    expect(res.body.diferencas).toEqual([{ sku: 'A1', nome: 'Produto A1', antes: { preco: 129.9, quantidade: 1 }, depois: null }]);
    expect(res.body.sessao.itens.map((i: { sku: string }) => i.sku)).toEqual(['B2']);
  });

  it('não finaliza duas vezes', async () => {
    await carrinho([{ produtoId: 'id-A1', quantidade: 1 }]);
    await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    const res = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('PEDIDO_JA_ENVIADO');
  });

  it('frete grátis acima do mínimo entra no total e na cotação', async () => {
    await configurar({ frete: { regra: 'gratis_acima_de', valor: 89.9, minimo: 200, prazo: 'Em até 3 dias úteis' } });
    await carrinho([{ produtoId: 'id-A1', quantidade: 1 }]);
    expect((await http().post(`/v1/catalogo/${token}/frete`).send({ cep: '39400-000' })).body).toEqual({
      titulo: 'Entrega',
      valor: 89.9,
      prazo: 'Em até 3 dias úteis',
    });
    expect((await http().post(`/v1/catalogo/${token}/frete`).send({ cep: '1' })).status).toBe(400);
    await carrinho([{ produtoId: 'id-A1', quantidade: 2 }]);
    const res = await finalizar({ tipo: 'entrega', entrega: ENTREGA });
    expect(res.body.totais).toMatchObject({ subtotal: 259.8, frete: 0, total: 259.8 });
  });
});
