import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { telefoneChave } from '../src/sessoes/clientes.service';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

const ENTREGA = {
  nome: 'Ana Souza',
  telefone: '(38) 98888-7777',
  cep: '39400000',
  estado: 'MG',
  cidade: 'Montes Claros',
  bairro: 'Centro',
  rua: 'Rua A',
  numero: '10',
  complemento: '',
  referencia: 'Perto da praça',
};

describe('histórico do cliente pelo telefone', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let ipSeq = 0;
  let ip = '';
  const pub = (metodo: 'get' | 'put' | 'post', url: string) => request(app.getHttpServer())[metodo](url).set('X-Forwarded-For', ip);

  async function comprar(token: string, itens: object[], entrega: object = ENTREGA) {
    await pub('put', `/v1/catalogo/${token}/carrinho`).send({ itens });
    return pub('post', `/v1/catalogo/${token}/finalizar`).send({ tipo: 'entrega', entrega });
  }

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.120.0.${ipSeq}`;
    reiniciarFalso();
    await limparBanco(prisma);
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('telefone vira chave só de dígitos com DDI', () => {
    expect(telefoneChave('5538988887777')).toBe('5538988887777');
    expect(telefoneChave('(38) 98888-7777')).toBe('5538988887777');
    expect(telefoneChave('3832221111')).toBe('553832221111');
    expect(telefoneChave('123')).toBeNull();
    expect(telefoneChave('')).toBeNull();
  });

  it('a finalização guarda o endereço e o pedido; o próximo link do mesmo telefone mostra os dois', async () => {
    const t1 = await gerarLink(app, loja, '100', { email: 'ana@x.com', documento: '123' });
    const fim = await comprar(t1, [{ produtoId: 'id-A1', quantidade: 2 }, { produtoId: 'id-C3', variacaoId: 'v1', quantidade: 1 }]);
    expect(fim.status).toBe(200);
    // O pré-cadastro não se perde na finalização.
    expect(fim.body.cliente).toEqual({ nome: 'Ana Souza', telefone: '(38) 98888-7777', email: 'ana@x.com', documento: '123' });

    const t2 = await gerarLink(app, loja, '200');
    const aberto = await pub('get', `/v1/catalogo/${t2}/abrir`);
    expect(aberto.body.historico.enderecos).toEqual([
      { cep: '39400-000', estado: 'MG', cidade: 'Montes Claros', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: '', referencia: 'Perto da praça' },
    ]);
    expect(aberto.body.historico.pedidos).toHaveLength(1);
    expect(aberto.body.historico.pedidos[0]).toMatchObject({
      total: 279.8,
      itens: [
        { produtoId: 'id-A1', variacaoId: null, sku: 'A1', nome: 'Produto A1', variacaoNome: null, quantidade: 2 },
        { produtoId: 'id-C3', variacaoId: 'v1', quantidade: 1 },
      ],
    });
    expect(typeof aberto.body.historico.pedidos[0].data).toBe('string');
  });

  it('endereço repetido não duplica, o mais recente vem primeiro e guarda no máximo 5', async () => {
    for (let i = 1; i <= 7; i++) {
      const t = await gerarLink(app, loja, `c${i}`);
      const numero = i === 7 ? '1' : String(i); // o 7º repete o endereço do 1º
      expect((await comprar(t, [{ produtoId: 'id-A1', quantidade: 1 }], { ...ENTREGA, numero })).status).toBe(200);
    }
    const cliente = await prisma.clienteLoja.findFirstOrThrow();
    const numeros = (cliente.enderecos as { numero: string }[]).map((e) => e.numero);
    expect(numeros).toEqual(['1', '6', '5', '4', '3']);
    expect((cliente.pedidos as unknown[]).length).toBe(5);
  });

  it('o endereço do contato da Kentro entra como opção quando ainda não foi usado', async () => {
    const t = await gerarLink(app, loja, '300', { endereco: { cep: '01001-000', rua: 'Praça da Sé', numero: '1', cidade: 'São Paulo', estado: 'SP' } });
    const aberto = await pub('get', `/v1/catalogo/${t}/abrir`);
    expect(aberto.body.historico.enderecos).toEqual([
      { cep: '01001-000', estado: 'SP', cidade: 'São Paulo', bairro: '', rua: 'Praça da Sé', numero: '1', complemento: '', referencia: '' },
    ]);
    expect(aberto.body.historico.pedidos).toEqual([]);
  });

  it('não mistura lojas nem telefones; sem telefone não há histórico', async () => {
    const t1 = await gerarLink(app, loja, '100');
    await comprar(t1, [{ produtoId: 'id-A1', quantidade: 1 }]);
    const outra = await lojaIntegrada(app);
    const tOutra = await gerarLink(app, outra, '100');
    expect((await pub('get', `/v1/catalogo/${tOutra}/abrir`)).body.historico).toEqual({ enderecos: [], pedidos: [] });
    const tOutroFone = await gerarLink(app, loja, '101', { telefone: '5511900000000' });
    expect((await pub('get', `/v1/catalogo/${tOutroFone}/abrir`)).body.historico.pedidos).toEqual([]);
    const tSemFone = await gerarLink(app, loja, '102', { telefone: '' });
    await prisma.sessao.updateMany({ where: { chatId: '102' }, data: { cliente: { nome: 'X', telefone: '' } } });
    expect((await pub('get', `/v1/catalogo/${tSemFone}/abrir`)).body.historico).toEqual({ enderecos: [], pedidos: [] });
  });

  it('retirada guarda o pedido mas não endereço', async () => {
    await prisma.configLoja.create({
      data: { lojaId: loja.lojaId, retirada: { habilitada: true }, lojasRetirada: [{ id: 'c', nome: 'Centro', endereco: 'Rua B', horario: '', orientacoes: '' }] },
    });
    const t = await gerarLink(app, loja, '100');
    await pub('put', `/v1/catalogo/${t}/carrinho`).send({ itens: [{ produtoId: 'id-A1', quantidade: 1 }] });
    expect((await pub('post', `/v1/catalogo/${t}/finalizar`).send({ tipo: 'retirada', lojaRetiradaId: 'c' })).status).toBe(200);
    const cliente = await prisma.clienteLoja.findFirstOrThrow();
    expect(cliente.enderecos).toEqual([]);
    expect((cliente.pedidos as unknown[]).length).toBe(1);
  });
});
