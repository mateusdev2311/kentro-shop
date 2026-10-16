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
});
