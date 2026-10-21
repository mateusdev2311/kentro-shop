import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigLojaService } from '../src/config-loja/config-loja.service';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();

describe('configuração da loja (padrões da Fase 1.2)', () => {
  let app: INestApplication;
  let servico: ConfigLojaService;

  beforeAll(async () => {
    app = await criarAppDeTeste();
    servico = app.get(ConfigLojaService);
  });
  beforeEach(() => limparBanco(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('loja sem configuração gravada recebe os padrões, com o nome da loja no tema', async () => {
    const loja = await prisma.loja.create({ data: { nome: 'Pisos & Cia', chaveAdminHash: 'a', chaveAtendimentoHash: 'b', tokenMcpHash: 'c' } });
    expect(await servico.obter(loja.id)).toEqual({
      tema: { nome: 'Pisos & Cia', corPrimaria: '#7C3AED', layout: 'grade', destaque: true, fonte: 'classica', cantos: 'arredondados', imagemProduto: 'quadrada', compreTambem: true, banners: [], bannerSegundos: 5 },
      entrega: { habilitada: true },
      retirada: { habilitada: false },
      lojasRetirada: [],
      frete: { regra: 'a_combinar' },
      expiracaoLinkDias: 7,
      modoPedido: 'handoff',
      categoriasOcultas: [],
      urlCapturaKentro: null,
      mostrarPrecos: true,
    });
    expect(await prisma.configLoja.count()).toBe(0);
  });

  it('valores gravados se sobrepõem aos padrões', async () => {
    const loja = await prisma.loja.create({ data: { nome: 'L', chaveAdminHash: 'a', chaveAtendimentoHash: 'b', tokenMcpHash: 'c' } });
    await prisma.configLoja.create({
      data: {
        lojaId: loja.id,
        tema: { corPrimaria: '#0a7' },
        retirada: { habilitada: true },
        lojasRetirada: [{ id: 'centro', nome: 'Centro', endereco: 'Rua A, 1', horario: '8h-18h', orientacoes: '' }],
        frete: { regra: 'gratis_acima_de', valor: 89.9, minimo: 2000 },
        expiracaoLinkDias: 3,
      },
    });
    const c = await servico.obter(loja.id);
    expect(c.tema).toEqual({ nome: 'L', corPrimaria: '#0a7', layout: 'grade', destaque: true, fonte: 'classica', cantos: 'arredondados', imagemProduto: 'quadrada', compreTambem: true, banners: [], bannerSegundos: 5 });
    expect(c.retirada.habilitada).toBe(true);
    expect(c.entrega.habilitada).toBe(true);
    expect(c.lojasRetirada).toHaveLength(1);
    expect(c.frete).toEqual({ regra: 'gratis_acima_de', valor: 89.9, minimo: 2000 });
    expect(c.expiracaoLinkDias).toBe(3);
  });

  it('apagar a loja apaga sessões, itens e eventos', async () => {
    const loja = await prisma.loja.create({ data: { chaveAdminHash: 'a', chaveAtendimentoHash: 'b', tokenMcpHash: 'c' } });
    const sessao = await prisma.sessao.create({
      data: { lojaId: loja.id, token: 't1', chatId: '9', cliente: {}, totais: {}, expiraEm: new Date(Date.now() + 1000) },
    });
    await prisma.itemCarrinho.create({
      data: { sessaoId: sessao.id, produtoId: 'A1', sku: 'A1', nome: 'A', unidade: 'UN', precoUnitario: 10, quantidade: 1 },
    });
    await prisma.eventoSessao.create({ data: { sessaoId: sessao.id, tipo: 'link', texto: 'x', autor: 'sistema' } });
    await prisma.loja.delete({ where: { id: loja.id } });
    expect(await prisma.sessao.count()).toBe(0);
    expect(await prisma.itemCarrinho.count()).toBe(0);
    expect(await prisma.eventoSessao.count()).toBe(0);
  });
});
