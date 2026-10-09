import { montarTela } from './omni-falso';

const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_abc' };
const lojaOk = { status: 200, body: { id: 'l1', nome: 'Pisos & Cia', status: 'ativa', plano: 'gratis', papel: 'atendimento' } };

describe('painel do atendimento (Fase 0)', () => {
  it('sem chave pede ao administrador para configurar e não chama a API', async () => {
    const tela = await montarTela('atendimento/painel.html', { config: { api_url: 'https://api.teste', chave_atendimento: '' } });
    expect(tela.texto('aviso')).toBe('Peça ao administrador para configurar o Kentro Shop.');
    expect(tela.chamadas).toHaveLength(0);
  });

  it('com a loja respondendo mostra que está conectado', async () => {
    const tela = await montarTela('atendimento/painel.html', { config, respostas: { 'GET /v1/loja': lojaOk } });
    expect(tela.texto('status')).toBe('Conectado à loja Pisos & Cia.');
  });

  it('loja sem nome aparece como "sem nome"', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config,
      respostas: { 'GET /v1/loja': { status: 200, body: { ...lojaOk.body, nome: null } } },
    });
    expect(tela.texto('status')).toBe('Conectado à loja sem nome.');
  });

  it('chave recusada explica que é preciso conferir a configuração', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config,
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
    });
    expect(tela.texto('aviso')).toBe(
      'A chave de atendimento do Kentro Shop é inválida. Peça ao administrador para conferir a configuração.',
    );
  });

  it('API fora do ar mostra mensagem genérica', async () => {
    const tela = await montarTela('atendimento/painel.html', { config, respostas: {} });
    expect(tela.texto('aviso')).toBe('Não foi possível falar com o Kentro Shop agora. Tente de novo em instantes.');
  });

  it('chave de admin colada no painel não conta como conectado', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config,
      respostas: { 'GET /v1/loja': { status: 200, body: { ...lojaOk.body, papel: 'admin' } } },
    });
    expect(tela.texto('aviso')).toBe(
      'Esta é a chave de admin. Peça ao administrador para colar a chave de atendimento na configuração do Kentro Shop — Atendimento.',
    );
    expect(tela.visivel('status')).toBe(false);
  });

  it('nome do usuário com emoji vai codificado no cabeçalho', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config,
      usuario: { id: 9, name: 'Zoë 🛍️', type: 2 },
      respostas: { 'GET /v1/loja': lojaOk },
    });
    expect(tela.chamadas[0].headers['X-Kentro-Usuario-Nome']).toBe(encodeURIComponent('Zoë 🛍️'));
  });

  it('remove a barra final da URL e as sobras da chave colada', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config: { api_url: 'https://api.teste//', chave_atendimento: ' ksk_abc\n' },
      respostas: { 'GET /v1/loja': lojaOk },
    });
    expect(tela.chamadas[0].url).toBe('https://api.teste/v1/loja');
    expect(tela.chamadas[0].method).toBe('GET');
    expect(tela.chamadas[0].headers['X-Loja-Chave']).toBe('ksk_abc');
    expect(tela.chamadas[0].headers['X-Kentro-Usuario-Id']).toBe('7');
  });
});
