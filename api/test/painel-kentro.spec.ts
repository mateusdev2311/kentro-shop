import { montarTela, OpcoesTela, Tela } from './omni-falso';

// Painel do atendimento com o catálogo da Kentro: mantém a cópia do Kentro Shop atualizada.

const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_abc' };
const loja = (plataforma: string) => ({ status: 200, body: { id: 'l1', nome: 'Pisos & Cia', status: 'ativa', plano: 'gratis', papel: 'atendimento', plataforma } });
const estado = (minutosAtras: number | null, sincronizando = false) => ({
  status: 200,
  body: {
    sincronizadoEm: minutosAtras === null ? null : new Date(Date.now() - minutosAtras * 60_000).toISOString(),
    total: 2,
    categorias: 1,
    sincronizando,
  },
});
const PRODUTOS = [{ id: 1, name: 'Porcelanato Bege', price: 119.9, groupIds: [1], available: true, hiddenFromClients: false }];

const lotes = (t: Tela) => t.chamadas.filter((c) => c.url.endsWith('/v1/loja/catalogo-kentro/lotes'));

function painel(respostas: OpcoesTela['respostas'], extra: Partial<OpcoesTela> = {}) {
  return montarTela('atendimento/painel.html', {
    config,
    produtos: PRODUTOS,
    respostas: { 'POST /v1/loja/catalogo-kentro/lotes': { status: 200, body: { recebidos: 1, total: 1 } }, ...respostas },
    ...extra,
  });
}

describe('painel: cópia do catálogo da Kentro', () => {
  let t: Tela;
  afterEach(() => t?.fechar());

  it('cópia com mais de 1 hora: sincroniza em segundo plano, com a chave de atendimento', async () => {
    t = await painel({ 'GET /v1/loja': loja('kentro'), 'GET /v1/loja/catalogo-kentro': estado(90) });
    await t.esperar(10);
    expect(lotes(t)).toHaveLength(1);
    expect(lotes(t)[0].headers['X-Loja-Chave']).toBe('ksk_abc');
    expect(JSON.parse(lotes(t)[0].body!)).toMatchObject({ parte: 0, ultima: true, produtos: [{ id: 1, name: 'Porcelanato Bege' }] });
  });

  it('nunca sincronizado também sincroniza', async () => {
    t = await painel({ 'GET /v1/loja': loja('kentro'), 'GET /v1/loja/catalogo-kentro': estado(null) });
    await t.esperar(10);
    expect(lotes(t)).toHaveLength(1);
  });

  it('cópia recente ou sincronização em andamento: não envia nada', async () => {
    t = await painel({ 'GET /v1/loja': loja('kentro'), 'GET /v1/loja/catalogo-kentro': estado(10) });
    await t.esperar(10);
    expect(lotes(t)).toHaveLength(0);
    t.fechar();
    t = await painel({ 'GET /v1/loja': loja('kentro'), 'GET /v1/loja/catalogo-kentro': estado(90, true) });
    await t.esperar(10);
    expect(lotes(t)).toHaveLength(0);
  });

  it('falha na sincronização não aparece para o atendente', async () => {
    t = await painel({
      'GET /v1/loja': loja('kentro'),
      'GET /v1/loja/catalogo-kentro': estado(90),
      'POST /v1/loja/catalogo-kentro/lotes': { status: 409, body: { erro: { codigo: 'CATALOGO_ENCOLHEU', mensagem: 'x' } } },
    });
    await t.esperar(10);
    expect(t.visivel('aviso')).toBe(false);
    expect(t.texto('status')).toBe('Conectado à loja Pisos & Cia.');
  });

  it('loja com outra plataforma nem consulta a cópia', async () => {
    t = await painel({ 'GET /v1/loja': loja('ecommercenet') });
    await t.esperar(10);
    expect(t.chamadas.some((c) => c.url.includes('catalogo-kentro'))).toBe(false);
  });
});
