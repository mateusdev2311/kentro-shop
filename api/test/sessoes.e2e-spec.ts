import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { SessoesService } from '../src/sessoes/sessoes.service';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

describe('sessões do catálogo', () => {
  let app: INestApplication;
  let servico: SessoesService;
  let loja: { lojaId: string; chaveAdmin: string; chaveAtendimento: string };
  const http = () => request(app.getHttpServer());

  async function registrar() {
    ipSeq += 1;
    return (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.5.0.${ipSeq}`).send({ nome: 'Loja S' })).body;
  }

  beforeAll(async () => {
    app = await criarAppDeTeste();
    servico = app.get(SessoesService);
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    loja = await registrar();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('serviço', () => {
    it('cria a sessão com link, evento e validade de 7 dias', async () => {
      const s = await servico.criarOuReaproveitar(loja.lojaId, { chatId: '123', nome: 'Ana Souza', telefone: '5538988887777' });
      expect(s.status).toBe('link_enviado');
      expect(s.url).toMatch(/^https:\/\/shop\.teste\/c\/[A-Za-z0-9_-]{32}$/);
      expect(s.cliente).toEqual({ nome: 'Ana Souza', telefone: '5538988887777' });
      expect(s.eventos.map((e) => e.texto)).toEqual(['Link do catálogo gerado']);
      const dias = (new Date(s.expiraEm).getTime() - Date.now()) / 86_400_000;
      expect(dias).toBeGreaterThan(6.9);
      expect(dias).toBeLessThan(7.1);
    });

    it('reaproveita a sessão aberta do mesmo chat e cria outra depois de finalizada', async () => {
      const a = await servico.criarOuReaproveitar(loja.lojaId, { chatId: '123', nome: 'Ana' });
      const b = await servico.criarOuReaproveitar(loja.lojaId, { chatId: '123', telefone: '5538999990000' });
      expect(b.url).toBe(a.url);
      expect(b.cliente).toEqual({ nome: 'Ana', telefone: '5538999990000' });
      await prisma.sessao.updateMany({ data: { status: 'finalizado', finalizadaEm: new Date() } });
      const c = await servico.criarOuReaproveitar(loja.lojaId, { chatId: '123' });
      expect(c.url).not.toBe(a.url);
    });

    it('link expirado ou de loja bloqueada é inválido', async () => {
      const s = await servico.criarOuReaproveitar(loja.lojaId, { chatId: '1' });
      const token = s.url.split('/c/')[1];
      await expect(servico.porToken(token)).resolves.toMatchObject({ chatId: '1' });
      await prisma.sessao.updateMany({ data: { expiraEm: new Date(Date.now() - 1000) } });
      await expect(servico.porToken(token)).rejects.toMatchObject({ codigo: 'LINK_INVALIDO' });
      await prisma.sessao.updateMany({ data: { expiraEm: new Date(Date.now() + 60_000) } });
      await prisma.loja.update({ where: { id: loja.lojaId }, data: { status: 'bloqueada' } });
      await expect(servico.porToken(token)).rejects.toMatchObject({ codigo: 'LINK_INVALIDO' });
      await expect(servico.porToken('nao-existe')).rejects.toMatchObject({ codigo: 'LINK_INVALIDO' });
    });

    it('abrir muda para navegando e registra o evento uma vez só', async () => {
      const s = await servico.criarOuReaproveitar(loja.lojaId, { chatId: '1' });
      const token = s.url.split('/c/')[1];
      await servico.abrir(token);
      const depois = await servico.abrir(token);
      expect(depois.status).toBe('navegando');
      expect(depois.abertaEm).not.toBeNull();
      const eventos = await prisma.eventoSessao.findMany({ where: { texto: 'Cliente abriu o catálogo' } });
      expect(eventos).toHaveLength(1);
      expect(eventos[0].autor).toBe('cliente');
    });
  });

  describe('rotas do atendimento', () => {
    const criar = (chave: string, corpo: object, nome?: string) => {
      const req = http().post('/v1/sessoes').set('X-Loja-Chave', chave);
      if (nome !== undefined) req.set('X-Kentro-Usuario-Nome', nome);
      return req.send(corpo);
    };
    const doChat = (chave: string, chatId: string) => http().get(`/v1/sessoes/chat/${chatId}`).set('X-Loja-Chave', chave);

    it('cria (201) com a URL pública e reaproveita (200)', async () => {
      const a = await criar(loja.chaveAtendimento, { chatId: ' 123 ', nome: 'Ana', telefone: '5538988887777' });
      expect(a.status).toBe(201);
      expect(a.body.url).toMatch(/^https:\/\/shop\.teste\/c\//);
      expect(a.body.resumo).toContain('Cliente: Ana');
      const b = await criar(loja.chaveAtendimento, { chatId: '123' });
      expect(b.status).toBe(200);
      expect(b.body.url).toBe(a.body.url);
      expect((await doChat(loja.chaveAtendimento, '123')).body.url).toBe(a.body.url);
    });

    it('o nome do atendente (codificado) entra no evento do link', async () => {
      const res = await criar(loja.chaveAtendimento, { chatId: '9' }, encodeURIComponent('Zoë 🛍️'));
      expect(res.body.eventos[0]).toMatchObject({ texto: 'Link do catálogo gerado por Zoë 🛍️', autor: 'atendente' });
      const torto = await criar(loja.chaveAtendimento, { chatId: '10' }, '%E0%A4%A');
      expect(torto.body.eventos[0].texto).toBe('Link do catálogo gerado');
    });

    it('chave inválida → 401; sem chatId → 400', async () => {
      expect((await criar('ksk_errada', { chatId: '1' })).status).toBe(401);
      expect((await doChat('ksk_errada', '1')).status).toBe(401);
      expect((await criar(loja.chaveAtendimento, {})).status).toBe(400);
      expect((await criar(loja.chaveAtendimento, { chatId: 'x'.repeat(65) })).status).toBe(400);
    });

    it('chat de outra loja não aparece', async () => {
      await criar(loja.chaveAtendimento, { chatId: '123' });
      const outra = await registrar();
      const res = await doChat(outra.chaveAtendimento, '123');
      expect(res.status).toBe(404);
      expect(res.body.erro.codigo).toBe('SEM_SESSAO');
    });
  });
});
