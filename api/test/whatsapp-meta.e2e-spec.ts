import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { lojaIntegrada, LojaDeTeste } from './apoio-sessao';
import { PRODUTOS_FALSOS, reiniciarFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';
import { ClienteMeta, erroDaMeta, ErroMeta, RespostaMeta } from '../src/whatsapp-meta/cliente-meta';
import { numeroWhatsapp } from '../src/whatsapp-meta/whatsapp-meta.service';

const prisma = new PrismaClient();
const TOKEN = 'EAAG-token-secreto';
const CONTA = { wabaId: '111111', telefoneId: '222222', token: TOKEN };

interface Chamada {
  token: string;
  metodo: string;
  caminho: string;
  corpo?: RespostaMeta;
}

describe('carrossel pelo WhatsApp oficial', () => {
  let app: INestApplication;
  let loja: LojaDeTeste & { tokenMcp: string };
  let chamadas: Chamada[];
  let templates: RespostaMeta[];
  let erroNoEnvio: ErroMeta | null;
  let fotosBaixadas: string[];
  let midias = 0;

  const meta: ClienteMeta = {
    chamar: async (token, metodo, caminho, corpo) => {
      chamadas.push({ token, metodo, caminho, corpo: corpo as RespostaMeta });
      if (caminho.startsWith('111111?')) return { id: '111111', name: 'Rede Biomax' };
      if (caminho.startsWith('111111/phone_numbers')) return { data: [{ id: '222222', display_phone_number: '+55 38 99999-0000' }] };
      if (caminho.startsWith('debug_token')) return { data: { app_id: '999' } };
      if (caminho.startsWith('111111/message_templates') && metodo === 'GET') return { data: templates };
      if (caminho === '111111/message_templates') {
        templates.push({ name: (corpo as RespostaMeta).name, status: 'PENDING', language: 'pt_BR' });
        return { id: 't' };
      }
      if (caminho === '222222/messages') {
        if (erroNoEnvio) throw erroNoEnvio;
        return { messages: [{ id: 'wamid.1' }] };
      }
      throw new Error(`chamada inesperada: ${metodo} ${caminho}`);
    },
    enviarMidia: async () => `midia-${++midias}`,
    enviarExemplo: async () => '4::exemplo',
    baixarFoto: async (url) => {
      fotosBaixadas.push(url);
      return url.includes('ruim') ? null : { bytes: Buffer.from('x'), tipo: 'image/jpeg' };
    },
  };

  const http = () => request(app.getHttpServer());
  const admin = (metodo: 'get' | 'put' | 'post' | 'delete', url: string) => http()[metodo](url).set('X-Loja-Chave', loja.chaveAdmin);
  const atendimento = (metodo: 'get' | 'post', url: string) => http()[metodo](url).set('X-Loja-Chave', loja.chaveAtendimento);
  const ligar = () => admin('put', '/v1/loja/whatsapp-meta').send(CONTA);
  const enviar = (extra: object = {}) =>
    atendimento('post', '/v1/sessoes/carrossel').send({ chatId: '100', telefone: '(38) 98888-7777', nome: 'Ana', produtoIds: ['id-A1', 'id-B2'], ...extra });
  const envios = () => chamadas.filter((c) => c.caminho === '222222/messages');
  const chamarMcp = async (name: string, args: object) => {
    const r = await http().post('/mcp').set('Authorization', `Bearer ${loja.tokenMcp}`).send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return { texto: r.body.result.content[0].text as string, erro: r.body.result.isError as boolean };
  };

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { clienteMeta: meta });
  });
  beforeEach(async () => {
    reiniciarFalso();
    await limparBanco(prisma);
    loja = (await lojaIntegrada(app)) as LojaDeTeste & { tokenMcp: string };
    chamadas = [];
    templates = [];
    erroNoEnvio = null;
    fotosBaixadas = [];
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('conta da Meta', () => {
    it('sem conta: o painel não mostra o botão e o envio explica o que falta', async () => {
      expect((await atendimento('get', '/v1/sessoes/carrossel/disponivel')).body).toEqual({ disponivel: false });
      expect((await admin('get', '/v1/loja/whatsapp-meta')).body).toEqual({ configurado: false });
      const r = await enviar();
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: false, codigo: 'CARROSSEL_INVALIDO' });
      expect(r.body.mensagem).toContain('ainda não foi ligado');
    });

    it('só o admin configura; o token fica cifrado e nunca volta', async () => {
      expect((await atendimento('get', '/v1/loja/whatsapp-meta' as string)).status).toBe(403);
      const salvo = await ligar();
      expect(salvo.body).toEqual({ configurado: true, wabaId: '111111', telefoneId: '222222', conta: 'Rede Biomax', numero: '+55 38 99999-0000' });
      const lido = await admin('get', '/v1/loja/whatsapp-meta');
      expect(lido.body).toEqual({ configurado: true, wabaId: '111111', telefoneId: '222222' });
      expect(JSON.stringify(lido.body)).not.toContain(TOKEN);
      const linha = await prisma.whatsappMeta.findUniqueOrThrow({ where: { lojaId: loja.lojaId } });
      expect(Buffer.from(linha.tokenCifrado).toString('latin1')).not.toContain(TOKEN);
      expect((await atendimento('get', '/v1/sessoes/carrossel/disponivel')).body).toEqual({ disponivel: true });
    });

    it('recusa número de outra conta sem gravar; token em branco mantém o atual', async () => {
      const outro = await admin('put', '/v1/loja/whatsapp-meta').send({ ...CONTA, telefoneId: '333333' });
      expect(outro.body).toMatchObject({ ok: false });
      expect(await prisma.whatsappMeta.count()).toBe(0);
      expect((await admin('put', '/v1/loja/whatsapp-meta').send({ wabaId: '111111', telefoneId: '222222' })).body.mensagem).toBe('Informe o token da Meta.');
      await ligar();
      chamadas = [];
      expect((await admin('put', '/v1/loja/whatsapp-meta').send({ wabaId: '111111', telefoneId: '222222' })).body.configurado).toBe(true);
      expect(chamadas[0].token).toBe(TOKEN);
      expect((await admin('put', '/v1/loja/whatsapp-meta').send({ wabaId: 'abc', telefoneId: '222222' })).status).toBe(400);
    });

    it('desconectar apaga o token', async () => {
      await ligar();
      await admin('delete', '/v1/loja/whatsapp-meta');
      expect(await prisma.whatsappMeta.count()).toBe(0);
    });
  });

  describe('templates', () => {
    it('lista todos os tamanhos e cria os que faltam, uma vez só', async () => {
      await ligar();
      templates = [{ name: 'kshop_carrossel_2', status: 'APPROVED', language: 'pt_BR' }, { name: 'outro', status: 'APPROVED', language: 'pt_BR' }];
      const lista = (await admin('get', '/v1/loja/whatsapp-meta/templates')).body.templates;
      expect(lista).toHaveLength(9);
      expect(lista[0]).toEqual({ cartoes: 2, nome: 'kshop_carrossel_2', status: 'APPROVED' });
      expect(lista[1].status).toBe('NAO_CRIADO');

      const criados = await admin('post', '/v1/loja/whatsapp-meta/templates');
      expect(criados.status).toBe(200);
      expect(criados.body.templates.filter((t: { status: string }) => t.status === 'PENDING')).toHaveLength(8);
      const posts = chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '111111/message_templates');
      expect(posts).toHaveLength(8);

      const tres = posts.find((c) => c.corpo!.name === 'kshop_carrossel_3')!.corpo!;
      expect(tres).toMatchObject({ language: 'pt_BR', category: 'marketing' });
      const cartoes = tres.components[1].cards;
      expect(cartoes).toHaveLength(3);
      expect(cartoes[0].components[0]).toEqual({ type: 'header', format: 'image', example: { header_handle: ['4::exemplo'] } });
      expect(cartoes[0].components[2].buttons[0]).toMatchObject({ type: 'url', url: 'https://shop.teste/c/{{1}}' });

      chamadas = [];
      await admin('post', '/v1/loja/whatsapp-meta/templates');
      expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
    });

    it('recusa da Meta chega com a mensagem', async () => {
      await ligar();
      const original = meta.enviarExemplo;
      meta.enviarExemplo = async () => {
        throw erroDaMeta(401, { error: { code: 190, message: 'x' } });
      };
      try {
        const r = await admin('post', '/v1/loja/whatsapp-meta/templates');
        expect(r.status).toBe(200);
        expect(r.body.mensagem).toContain('token da Meta é inválido');
      } finally {
        meta.enviarExemplo = original;
      }
    });
  });

  describe('envio', () => {
    beforeEach(() => ligar());

    it('manda o template do tamanho certo, com foto, nome, preço e o link do atendimento', async () => {
      const r = await enviar();
      expect(r.body).toMatchObject({ quantidade: 2, mensagemId: 'wamid.1' });
      const token = String(r.body.url).split('/c/')[1];
      expect(token.length).toBeGreaterThan(10);

      const corpo = envios()[0].corpo!;
      expect(corpo).toMatchObject({ messaging_product: 'whatsapp', to: '5538988887777', type: 'template' });
      expect(corpo.template.name).toBe('kshop_carrossel_2');
      expect(corpo.template.language).toEqual({ code: 'pt_BR' });
      const cartao = corpo.template.components[0].cards[0];
      expect(cartao.card_index).toBe(0);
      expect(cartao.components[0].parameters[0].type).toBe('image');
      expect(cartao.components[0].parameters[0].image.id).toMatch(/^midia-/);
      expect(cartao.components[1].parameters.map((p: { text: string }) => p.text)).toEqual([expect.any(String), 'de R$ 149,90 por R$ 129,90']);
      expect(cartao.components[2]).toEqual({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: token }] });
      expect(fotosBaixadas).toEqual(['https://img.teste/A1.jpg', 'https://img.teste/B2.jpg']);

      // O link abre nos produtos do carrossel, e o envio fica na atividade do atendimento.
      const vitrine = await http().get(`/v1/catalogo/${token}/produtos?selecao=1`).set('X-Forwarded-For', '10.150.0.1');
      expect(vitrine.body.itens.map((p: { id: string }) => p.id)).toEqual(['id-A1', 'id-B2']);
      expect(r.body.sessao.eventos[0].texto).toBe('Carrossel com 2 produtos enviado pelo atendente');
    });

    it('produto com variações mostra o menor preço; loja sem preço manda "sob consulta"', async () => {
      await enviar({ produtoIds: ['id-C3', 'id-B2'] });
      expect(envios()[0].corpo!.template.components[0].cards[0].components[1].parameters[1].text).toBe('R$ 20,00');
      await prisma.eventoSessao.deleteMany({ where: { tipo: 'carrossel' } });
      await admin('put', '/v1/loja/whatsapp-meta').send(CONTA);
      await http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send({ mostrarPrecos: false });
      await enviar({ chatId: '101' });
      expect(envios()[1].corpo!.template.components[0].cards[0].components[1].parameters[1].text).toBe('sob consulta');
    });

    it('usa o telefone já guardado quando não vem nenhum; sem telefone válido, recusa', async () => {
      expect((await enviar({ telefone: '123' })).body.mensagem).toContain('telefone válido');
      expect(envios()).toHaveLength(0);
      await atendimento('post', '/v1/sessoes').send({ chatId: '100', telefone: '38988887777' });
      await enviar({ telefone: undefined });
      expect(envios()[0].corpo!.to).toBe('5538988887777');
    });

    it('avisa quais produtos trocar: não achado, sem estoque, sem foto ou foto inválida', async () => {
      const b2 = PRODUTOS_FALSOS.find((p) => p.id === 'id-B2')!;
      const { estoque, imagens } = b2;
      try {
        expect((await enviar({ produtoIds: ['id-A1', 'nao-existe'] })).body.mensagem).toContain('nao-existe (não encontrado)');
        b2.estoque = 0;
        loja = (await lojaIntegrada(app)) as typeof loja;
        await ligar();
        expect((await enviar()).body.mensagem).toContain('(sem estoque)');
        b2.estoque = estoque;
        b2.imagens = [];
        loja = (await lojaIntegrada(app)) as typeof loja;
        await ligar();
        expect((await enviar()).body.mensagem).toContain('(sem foto)');
        b2.imagens = ['https://img.teste/ruim.webp'];
        loja = (await lojaIntegrada(app)) as typeof loja;
        await ligar();
        expect((await enviar()).body.mensagem).toContain('só aceita esses formatos');
      } finally {
        b2.estoque = estoque;
        b2.imagens = imagens;
      }
      expect(envios()).toHaveLength(0);
    });

    it('não repete o envio no mesmo atendimento em menos de um minuto', async () => {
      await enviar();
      const segundo = await enviar();
      expect(segundo.body.mensagem).toContain('Aguarde um minuto');
      expect(envios()).toHaveLength(1);
      await enviar({ chatId: '200' });
      expect(envios()).toHaveLength(2);
    });

    it('recusa da Meta no envio chega traduzida e não conta como enviado', async () => {
      erroNoEnvio = erroDaMeta(400, { error: { code: 132001, message: 'x' } });
      expect((await enviar()).body.mensagem).toContain('ainda não foi aprovado');
      expect(await prisma.eventoSessao.count({ where: { tipo: 'carrossel' } })).toBe(0);
    });

    it('valida de 2 a 10 produtos', async () => {
      expect((await enviar({ produtoIds: ['id-A1'] })).status).toBe(400);
      expect((await enviar({ produtoIds: Array.from({ length: 11 }, (_, i) => `p${i}`) })).status).toBe(400);
      expect((await enviar({ produtoIds: ['id-A1', 'id-A1'] })).body.mensagem).toContain('2 a 10 produtos diferentes');
    });

    it('a IA envia pelo MCP e a atividade registra', async () => {
      const r = await chamarMcp('enviar_carrossel', { chat_id: '100', telefone: '38988887777', nome: 'Ana', produto_ids: ['id-A1', 'id-B2', 'id-C3'] });
      expect(r.erro).toBeFalsy();
      expect(r.texto).toContain('Carrossel com 3 produtos enviado');
      expect(envios()[0].corpo!.template.name).toBe('kshop_carrossel_3');
      const evento = await prisma.eventoSessao.findFirstOrThrow({ where: { tipo: 'carrossel' } });
      expect(evento).toMatchObject({ autor: 'ia', texto: 'Carrossel com 3 produtos enviado pela IA' });
    });
  });

  it('o MCP explica quando o WhatsApp oficial não está ligado', async () => {
    const r = await chamarMcp('enviar_carrossel', { chat_id: '100', telefone: '38988887777', produto_ids: ['id-A1', 'id-B2'] });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('use o link do catálogo');
  });

  it('formata o número no padrão da Meta', () => {
    expect(numeroWhatsapp('(38) 98888-7777')).toBe('5538988887777');
    expect(numeroWhatsapp('3832217777')).toBe('553832217777');
    expect(numeroWhatsapp('5538988887777')).toBe('5538988887777');
    expect(numeroWhatsapp('12345')).toBeNull();
  });

  it('traduz os erros da Meta e guarda o subcódigo', () => {
    expect(erroDaMeta(400, { error: { code: 10, error_subcode: 2494010, message: '(#10) Application does not have permission for this action', error_data: { details: 'Motivo real' } } }).mensagem).toBe(
      'A Meta negou esta operação por permissão. Detalhe da Meta: #10/2494010 (#10) Application does not have permission for this action — Motivo real.',
    );
    expect(erroDaMeta(403, { error: { code: 200 } }).mensagem).toBe('A Meta negou esta operação por permissão. Detalhe da Meta: #200.');
    expect(erroDaMeta(429, { error: { code: 130429 } }).mensagem).toContain('excesso de envios');
    expect(erroDaMeta(400, { error: { code: 131026 } }).mensagem).toContain('não ter WhatsApp');
    expect(erroDaMeta(400, { error: { code: 1, error_data: { details: 'Motivo real' } } }).mensagem).toBe('A Meta recusou: Motivo real');
    expect(erroDaMeta(400, { error: { code: 100, error_subcode: 2388024 } }).subcodigoMeta).toBe(2388024);
  });
});
