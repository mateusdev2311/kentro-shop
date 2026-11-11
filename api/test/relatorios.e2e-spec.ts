import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { periodo } from '../src/relatorios/relatorios.service';
import { SessoesService } from '../src/sessoes/sessoes.service';
import { criarAppDeTeste } from './app';
import { lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

const ENTREGA = { nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '39400000', estado: 'MG', cidade: 'Montes Claros', bairro: 'Centro', rua: 'Rua A', numero: '10' };

describe('relatórios de vendas (aba Relatórios do admin)', () => {
  let app: INestApplication;
  let loja: LojaDeTeste;
  let ipSeq = 0;
  const http = () => request(app.getHttpServer());
  const relatorio = (consulta = '', chave = loja.chaveAdmin) => http().get(`/v1/loja/relatorios${consulta}`).set('X-Loja-Chave', chave);
  const ip = () => `10.150.0.${(ipSeq += 1)}`;

  /** Link gerado pelo painel, com o nome do atendente (a Bruna pelo cabeçalho novo, o Carlos pelo antigo). */
  const pelaAtendente = async (nome: string, chatId: string) => {
    const r = await http()
      .post('/v1/sessoes')
      .set('X-Loja-Chave', loja.chaveAtendimento)
      .set(nome === 'Bruna' ? 'X-Atendente-Nome' : 'X-Kentro-Usuario-Nome', encodeURIComponent(nome))
      .send({ chatId, nome: 'Ana Souza', telefone: '5538988887777' });
    return { id: r.body.id as string, token: String(r.body.url).split('/c/')[1] };
  };
  const clienteCompra = async (token: string, quantidade: number) => {
    const origem = ip();
    await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', origem).send({ itens: [{ produtoId: 'id-A1', quantidade }] });
    const r = await http().post(`/v1/catalogo/${token}/finalizar`).set('X-Forwarded-For', origem).send({ tipo: 'entrega', entrega: ENTREGA });
    expect(r.status).toBe(200);
  };

  /** Cinco atendimentos: Bruna (1 venda, 1 só link), Carlos (fecha pelo painel), IA (1 venda) e URA (só abriu). */
  const montarCenario = async () => {
    const b1 = await pelaAtendente('Bruna', '1');
    await clienteCompra(b1.token, 1); // 129,90
    await pelaAtendente('Bruna', '2');

    const c = await pelaAtendente('Carlos', '3');
    await http().post(`/v1/sessoes/${c.id}/itens`).set('X-Loja-Chave', loja.chaveAtendimento).send({ itens: [{ produtoId: 'id-A1', quantidade: 2 }] });
    const fechou = await http()
      .post(`/v1/sessoes/${c.id}/finalizar`)
      .set('X-Loja-Chave', loja.chaveAtendimento)
      .set('X-Kentro-Usuario-Nome', encodeURIComponent('Carlos'))
      .send({ tipo: 'entrega', entrega: ENTREGA });
    expect(fechou.status).toBe(200); // 259,80

    const ia = await app.get(SessoesService).criarOuReaproveitar(loja.lojaId, { chatId: '4' }, '', null, 'ia');
    await clienteCompra(String(ia.sessao.url).split('/c/')[1], 1); // 129,90

    const chaveUra = (await http().post('/v1/loja/chave-automacao/rotacionar').set('X-Loja-Chave', loja.chaveAdmin)).body.chave;
    const ura = await http().post('/v1/automacao/link').set('X-Loja-Chave', chaveUra).send({ chatId: '5' });
    await http().get(`/v1/catalogo/${String(ura.body.url).split('/c/')[1]}/abrir`).set('X-Forwarded-For', ip());
  };

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

  it('mostra links, conversão, valor, origem (IA, URA, atendente), quem fechou, dias e produtos', async () => {
    await montarCenario();
    const r = await relatorio();
    expect(r.status).toBe(200);
    const rel = r.body;
    expect(rel.periodo.dias).toBe(30);
    expect(rel.resumo).toEqual({
      links: 5,
      convertidos: 3,
      pedidos: 3,
      valor: 519.6,
      abertos: 3, // os dois clientes que compraram e o da URA; o carrinho do Carlos foi montado no painel
      ticketMedio: 173.2,
      cancelados: 0,
      entrega: 3,
      retirada: 0,
      naLoja: 0,
    });
    expect(rel.porOrigem).toEqual([
      { origem: 'ia', links: 1, convertidos: 1, pedidos: 1, valor: 129.9 },
      { origem: 'ura', links: 1, convertidos: 0, pedidos: 0, valor: 0 },
      { origem: 'atendente', links: 3, convertidos: 2, pedidos: 2, valor: 389.7 },
    ]);
    expect(rel.porAtendente).toEqual([
      { nome: 'Carlos', links: 1, convertidos: 1, pedidos: 1, valor: 259.8, fechadosNoPainel: 1, valorNoPainel: 259.8 },
      { nome: 'Bruna', links: 2, convertidos: 1, pedidos: 1, valor: 129.9, fechadosNoPainel: 0, valorNoPainel: 0 },
    ]);
    expect(rel.quemFinalizou).toEqual({ cliente: { pedidos: 2, valor: 259.8 }, atendente: { pedidos: 1, valor: 259.8 } });

    expect(rel.porDia).toHaveLength(30);
    expect(rel.porDia.at(-1)).toEqual({ dia: rel.periodo.ate, links: 5, pedidos: 3, valor: 519.6 });
    expect(rel.porDia.slice(0, -1).every((d: { links: number; pedidos: number }) => d.links === 0 && d.pedidos === 0)).toBe(true);
    expect(rel.produtos).toEqual([{ nome: 'Produto A1', quantidade: 4, valor: 519.6, pedidos: 3 }]);

    expect(rel.pedidos).toHaveLength(3);
    expect(rel.pedidos.map((p: { origem: string; geradoPor: string; finalizadaPor: string; finalizadaPorNome: string; total: number }) => [p.origem, p.geradoPor, p.finalizadaPor, p.finalizadaPorNome, p.total])).toEqual([
      ['ia', '', 'cliente', '', 129.9],
      ['atendente', 'Carlos', 'atendente', 'Carlos', 259.8],
      ['atendente', 'Bruna', 'cliente', '', 129.9],
    ]);
    expect(rel.pedidos[0]).toMatchObject({ chatId: '4', cliente: 'Ana Souza', tipo: 'entrega', cancelado: false });
    expect(rel.listaCortada).toBe(false);
  });

  it('pedido cancelado na loja sai do valor vendido e conta à parte', async () => {
    await montarCenario();
    const carlos = await prisma.sessao.findFirstOrThrow({ where: { lojaId: loja.lojaId, chatId: '3' } });
    await prisma.sessao.update({ where: { id: carlos.id }, data: { status: 'pedido_criado', pedido: { idExterno: '8-1', numero: '1', status: 'CANCELADO', descricao: 'Cancelado' } } });
    const { resumo, quemFinalizou, produtos, pedidos } = (await relatorio()).body;
    expect(resumo).toMatchObject({ pedidos: 2, valor: 259.8, cancelados: 1, naLoja: 0 });
    expect(quemFinalizou.atendente).toEqual({ pedidos: 0, valor: 0 });
    expect(produtos[0]).toMatchObject({ quantidade: 2, valor: 259.8, pedidos: 2 });
    expect(pedidos.find((p: { chatId: string }) => p.chatId === '3')).toMatchObject({ cancelado: true, situacao: 'Cancelado', pedidoNumero: '1' });
  });

  it('o período filtra pelos dias de Brasília; datas erradas e períodos longos são recusados; só o admin vê', async () => {
    await montarCenario();
    const antigo = (await relatorio('?de=2020-01-01&ate=2020-01-31')).body;
    expect(antigo.periodo).toEqual({ de: '2020-01-01', ate: '2020-01-31', dias: 31 });
    expect(antigo.resumo).toMatchObject({ links: 0, pedidos: 0, valor: 0 });
    expect(antigo.porAtendente).toEqual([]);

    expect((await relatorio('?de=2026-13-01')).status).toBe(400);
    expect((await relatorio('?de=2026-02-30')).status).toBe(400);
    expect((await relatorio('?de=2026-11-10&ate=2026-11-01')).status).toBe(400);
    expect((await relatorio('?de=2024-01-01&ate=2026-01-01')).status).toBe(400);
    expect((await relatorio('?extra=1')).status).toBe(400);
    expect((await relatorio('', loja.chaveAtendimento)).status).toBe(403);
  });

  it('dia de Brasília: 23h de 10/11 em Brasília ainda é dia 10 (02h UTC do dia 11)', () => {
    const p = periodo('2026-11-10', '2026-11-10');
    expect(p.inicio.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(p.fim.toISOString()).toBe('2026-11-11T03:00:00.000Z');
    expect(periodo(undefined, undefined, new Date('2026-11-11T02:00:00Z'))).toMatchObject({ de: '2026-10-12', ate: '2026-11-10', dias: 30 });
  });

  it('a migration preenche a origem e quem finalizou dos atendimentos antigos pelos eventos', async () => {
    await montarCenario();
    const campos = { chatId: true, origem: true, geradoPor: true, finalizadaPor: true, finalizadaPorNome: true } as const;
    const ler = () => prisma.sessao.findMany({ where: { lojaId: loja.lojaId }, select: campos, orderBy: { chatId: 'asc' } });
    const gravados = await ler();
    expect(gravados).toEqual([
      { chatId: '1', origem: 'atendente', geradoPor: 'Bruna', finalizadaPor: 'cliente', finalizadaPorNome: '' },
      { chatId: '2', origem: 'atendente', geradoPor: 'Bruna', finalizadaPor: null, finalizadaPorNome: '' },
      { chatId: '3', origem: 'atendente', geradoPor: 'Carlos', finalizadaPor: 'atendente', finalizadaPorNome: 'Carlos' },
      { chatId: '4', origem: 'ia', geradoPor: '', finalizadaPor: 'cliente', finalizadaPorNome: '' },
      { chatId: '5', origem: 'ura', geradoPor: '', finalizadaPor: null, finalizadaPorNome: '' },
    ]);

    // Como antes da migration: tudo no padrão. Os UPDATEs dela devem reconstruir o mesmo pelos eventos.
    await prisma.sessao.updateMany({ where: { lojaId: loja.lojaId }, data: { origem: 'atendente', geradoPor: '', finalizadaPor: null, finalizadaPorNome: '' } });
    const sql = readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261111180000_relatorios', 'migration.sql'), 'utf8');
    const updates = sql
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('UPDATE'));
    expect(updates).toHaveLength(3);
    for (const u of updates) await prisma.$executeRawUnsafe(u);
    expect(await ler()).toEqual(gravados);
  });
});
