import { montarTela, OpcoesTela, Tela } from './omni-falso';

// Painel do atendimento com as filas da unidade configuradas no Admin: só aparece nos atendimentos delas.

const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_abc' };
const loja = (filasAtendimento: number[]) => ({
  status: 200,
  body: { id: 'l1', nome: 'Farmácia Loja 08', status: 'ativa', plano: 'gratis', papel: 'atendimento', plataforma: 'automatiza', filasAtendimento },
});
const contato = { name: 'Maria', phone: '5538999990000' };
const semSessao = { status: 404, body: { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Nenhuma sessão.' } } };

function tela(filas: number[], { respostas, ...extra }: Partial<OpcoesTela>) {
  return montarTela('atendimento/painel.html', {
    config,
    ...extra,
    respostas: {
      'GET /v1/loja': loja(filas),
      'GET /v1/loja/catalogo/categorias': { status: 200, body: [] },
      ...respostas,
    },
  });
}

const chamouSessao = (t: Tela) => t.chamadas.some((c) => c.url.includes('/v1/sessoes/chat/'));
const semSessaoPara = (...ids: number[]) => Object.fromEntries(ids.map((id) => [`GET /v1/sessoes/chat/${id}`, semSessao]));

describe('painel do atendimento: filas da unidade', () => {
  let t: Tela;
  afterEach(() => t?.fechar());

  it('atendimento de outra fila: avisa e não carrega o carrinho', async () => {
    t = await tela([8, 9], { chat: { id: 501, queueId: 3, contact: contato } });
    await t.esperar(20);
    expect(t.visivel('fora-da-fila')).toBe(true);
    expect(t.texto('fora-da-fila')).toMatch(/Atendimento de outra fila/);
    expect(t.visivel('sem-sessao')).toBe(false);
    expect(chamouSessao(t)).toBe(false);
  });

  it('atendimento de uma fila da unidade: painel normal', async () => {
    t = await tela([8, 9], { chat: { id: 502, queueId: 9, contact: contato }, respostas: semSessaoPara(502, 503, 504, 506) });
    await t.esperar(20);
    expect(t.visivel('fora-da-fila')).toBe(false);
    expect(t.visivel('sem-sessao')).toBe(true);
    expect(chamouSessao(t)).toBe(true);
  });

  it('o evento sem a fila: lê o atendimento para saber a fila', async () => {
    t = await tela([8], { chat: { id: 503, contact: contato }, chatsPorId: { '503': { id: 503, queueId: 8 } }, respostas: semSessaoPara(502, 503, 504, 506) });
    await t.esperar(20);
    expect(t.visivel('fora-da-fila')).toBe(false);
    expect(t.visivel('sem-sessao')).toBe(true);
  });

  it('trocar para um atendimento de outra fila esconde as ferramentas; voltar para a unidade mostra de novo', async () => {
    t = await tela([8], { chat: { id: 504, queueId: 8, contact: contato }, respostas: semSessaoPara(502, 503, 504, 506) });
    await t.esperar(20);
    expect(t.visivel('sem-sessao')).toBe(true);
    await t.emitir('omniChatSelected', { id: 505, queueId: 4, contact: contato });
    await t.esperar(10);
    expect(t.visivel('fora-da-fila')).toBe(true);
    expect(t.visivel('sem-sessao')).toBe(false);
    await t.emitir('omniChatSelected', { id: 504, queueId: 8, contact: contato });
    await t.esperar(10);
    expect(t.visivel('fora-da-fila')).toBe(false);
    expect(t.visivel('sem-sessao')).toBe(true);
  });

  it('sem filas configuradas: vale para todas', async () => {
    t = await tela([], { chat: { id: 506, queueId: 77, contact: contato }, respostas: semSessaoPara(502, 503, 504, 506) });
    await t.esperar(20);
    expect(t.visivel('fora-da-fila')).toBe(false);
    expect(t.visivel('sem-sessao')).toBe(true);
  });
});
