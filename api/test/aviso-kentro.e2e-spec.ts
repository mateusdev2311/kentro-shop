import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AvisoKentro } from '../src/sessoes/aviso-kentro';
import { criarAppDeTeste } from './app';
import { gerarLink, lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
const CAPTURA = 'https://cliente.atenderbem.com/webhookcapture/capture/690315f0f22b49608e952ef07f86c540';

const ENTREGA = {
  nome: 'Ana Souza',
  telefone: '(38) 98888-7777',
  cep: '39400000',
  estado: 'MG',
  cidade: 'Montes Claros',
  bairro: 'Centro',
  rua: 'Rua A',
  numero: '10',
};

describe('aviso de pedido finalizado para a Kentro', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let ipSeq = 0;
  const enviados: { url: string; aviso: AvisoKentro }[] = [];
  let resposta: () => Promise<number> = async () => 200;
  const http = () => request(app.getHttpServer());
  const configurar = (corpo: object) => http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send(corpo);
  const finalizarPedido = async (chatId: string) => {
    ipSeq += 1;
    const ip = `10.140.0.${ipSeq}`;
    const token = await gerarLink(app, loja, chatId);
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', ip).send({ itens: [{ produtoId: 'id-A1', quantidade: 2 }] });
    return http().post(`/v1/catalogo/${token}/finalizar`).set('X-Forwarded-For', ip).send({ tipo: 'entrega', entrega: ENTREGA });
  };

  beforeAll(async () => {
    app = await criarAppDeTeste(
      {},
      {
        envioAviso: async (url, aviso) => {
          enviados.push({ url, aviso });
          return resposta();
        },
      },
    );
  });
  beforeEach(async () => {
    reiniciarFalso();
    await limparBanco(prisma);
    enviados.length = 0;
    resposta = async () => 200;
    loja = await lojaIntegrada(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('só aceita o endereço de uma captura de webhook https; vazio desliga', async () => {
    expect((await configurar({ urlCapturaKentro: 'http://cliente.atenderbem.com/webhookcapture/capture/abcdef123' })).status).toBe(400);
    expect((await configurar({ urlCapturaKentro: 'https://cliente.atenderbem.com/api/outra-coisa' })).status).toBe(400);
    expect((await configurar({ urlCapturaKentro: 'https://127.0.0.1/webhookcapture/capture/abcdef123' })).status).toBe(400);
    const ok = await configurar({ urlCapturaKentro: ` ${CAPTURA} ` });
    expect(ok.status).toBe(200);
    expect(ok.body.urlCapturaKentro).toBe(CAPTURA);
    expect((await configurar({ urlCapturaKentro: '' })).body.urlCapturaKentro).toBeNull();
    // A chave de atendimento não muda a configuração.
    expect((await http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAtendimento).send({ urlCapturaKentro: CAPTURA })).status).toBe(403);
  });

  it('sem captura configurada, finaliza sem avisar ninguém', async () => {
    expect((await finalizarPedido('300')).status).toBe(200);
    expect(enviados).toEqual([]);
  });

  it('ao finalizar, avisa a captura com o atendimento, o total e o resumo, e registra na atividade', async () => {
    await configurar({ urlCapturaKentro: CAPTURA });
    expect((await finalizarPedido('301')).status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].url).toBe(CAPTURA);
    expect(enviados[0].aviso).toMatchObject({
      evento: 'carrinho_finalizado',
      chatId: '301',
      nome: 'Ana Souza',
      tipo: 'entrega',
      total: 259.8,
      totalTexto: 'R$ 259,80',
      itens: 2,
      pedidoNumero: '',
      linkPagamento: '',
    });
    expect(enviados[0].aviso.resumo).toContain('Produto A1');
    const painel = await http().get('/v1/sessoes/chat/301').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(painel.body.eventos.map((e: { texto: string }) => e.texto)).toContain('Kentro avisada: a assistente de IA vai confirmar o pedido');
  });

  it('falha no aviso não desfaz o pedido e fica registrada', async () => {
    await configurar({ urlCapturaKentro: CAPTURA });
    resposta = async () => {
      throw new Error('fora do ar');
    };
    const res = await finalizarPedido('302');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('finalizado');
    const painel = await http().get('/v1/sessoes/chat/302').set('X-Loja-Chave', loja.chaveAtendimento);
    expect(painel.body.eventos.map((e: { texto: string }) => e.texto)).toContain('Aviso à Kentro não entregue (sem resposta)');
  });

  it('testar evento: exige a chave de admin e a captura salva', async () => {
    const testar = (chave = loja.chaveAdmin) => http().post('/v1/loja/ia/testar-evento').set('X-Loja-Chave', chave);
    expect((await testar()).status).toBe(400);
    await configurar({ urlCapturaKentro: CAPTURA });
    expect((await testar(loja.chaveAtendimento)).status).toBe(403);
    const ok = await testar();
    expect(ok.body).toEqual({ ok: true, status: 200 });
    expect(enviados[0].aviso).toMatchObject({ evento: 'teste', chatId: '0' });
    resposta = async () => 404;
    expect((await testar()).body).toEqual({ ok: false, status: 404 });
  });
});
