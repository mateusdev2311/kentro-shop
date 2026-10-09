import { montarTela } from './omni-falso';

const registro = { lojaId: 'l1', chaveAdmin: 'ksa_1', chaveAtendimento: 'ksk_1', tokenMcp: 'ksm_1' };
const semChave = { api_url: 'https://api.teste/', chave_admin: '' };

describe('Configurações do admin (Fase 0)', () => {
  it('sem chave oferece criar a loja ou informar uma chave', async () => {
    const tela = await montarTela('admin/config.html', { config: semChave });
    expect(tela.visivel('btn-criar')).toBe(true);
    expect(tela.texto('btn-criar')).toBe('Criar minha loja no Kentro Shop');
    expect(tela.texto('btn-ja-tenho')).toBe('Já tenho uma chave');
    expect(tela.visivel('chaves')).toBe(false);
    expect(tela.chamadas).toHaveLength(0);
  });

  it('"Já tenho uma chave" mostra onde colar', async () => {
    const tela = await montarTela('admin/config.html', { config: semChave });
    await tela.clicar('btn-ja-tenho');
    expect(tela.visivel('ajuda-chave')).toBe(true);
  });

  it('criar a loja registra, mostra as três chaves e guarda até serem coladas', async () => {
    const tela = await montarTela('admin/config.html', {
      config: semChave,
      respostas: { 'POST /v1/lojas/registrar': { status: 201, body: registro } },
    });
    (tela.document.getElementById('nome-loja') as HTMLInputElement).value = 'Loja X';
    await tela.clicar('btn-criar');

    expect(tela.chamadas).toHaveLength(1);
    expect(tela.chamadas[0].url).toBe('https://api.teste/v1/lojas/registrar');
    expect(tela.chamadas[0].method).toBe('POST');
    expect(JSON.parse(tela.chamadas[0].body!)).toEqual({ nome: 'Loja X' });

    expect(tela.visivel('chaves')).toBe(true);
    expect(tela.texto('valor-chave-admin')).toBe('ksa_1');
    expect(tela.texto('valor-chave-atendimento')).toBe('ksk_1');
    expect(tela.texto('valor-token-mcp')).toBe('ksm_1');
    expect(tela.texto('chaves')).toContain('Estas chaves aparecem só agora. Copie antes de fechar.');
    expect(tela.storage.chaves_pendentes).toMatchObject({ chaveAdmin: 'ksa_1', chaveAtendimento: 'ksk_1', tokenMcp: 'ksm_1' });
  });

  it('nome vazio não é enviado', async () => {
    const tela = await montarTela('admin/config.html', {
      config: semChave,
      respostas: { 'POST /v1/lojas/registrar': { status: 201, body: registro } },
    });
    await tela.clicar('btn-criar');
    expect(JSON.parse(tela.chamadas[0].body!)).toEqual({});
  });

  it('reabrir antes de colar mostra as chaves guardadas sem registrar outra loja', async () => {
    const tela = await montarTela('admin/config.html', {
      config: semChave,
      storage: { chaves_pendentes: { ...registro, em: '2026-10-09T12:00:00Z' } },
    });
    expect(tela.visivel('chaves')).toBe(true);
    expect(tela.texto('valor-chave-admin')).toBe('ksa_1');
    expect(tela.chamadas).toHaveLength(0);
  });

  it('com a chave configurada mostra a loja e descarta as chaves guardadas', async () => {
    const tela = await montarTela('admin/config.html', {
      config: { api_url: 'https://api.teste', chave_admin: 'ksa_1' },
      storage: { chaves_pendentes: { ...registro } },
      respostas: { 'GET /v1/loja': { status: 200, body: { id: 'l1', nome: 'Loja X', status: 'pendente_integracao', plano: 'gratis', papel: 'admin' } } },
    });
    expect(tela.texto('status')).toBe('Loja Loja X configurada. Status: pendente_integracao.');
    expect(tela.chamadas[0].headers['X-Loja-Chave']).toBe('ksa_1');
    expect(tela.storage.chaves_pendentes).toBeUndefined();
  });

  it('envia a instância da Kentro no registro, para o limite ser por instância', async () => {
    const tela = await montarTela('admin/config.html', {
      config: semChave,
      respostas: { 'POST /v1/lojas/registrar': { status: 201, body: registro } },
    });
    await tela.clicar('btn-criar');
    expect(tela.chamadas[0].headers['X-Kentro-Instancia']).toBe('loja.kentro.test');
  });

  it('nome do usuário com emoji vai codificado no cabeçalho', async () => {
    const tela = await montarTela('admin/config.html', {
      config: { api_url: 'https://api.teste', chave_admin: 'ksa_1' },
      usuario: { id: 9, name: 'Zoë 🛍️', type: 0 },
      respostas: { 'GET /v1/loja': { status: 200, body: { id: 'l1', nome: 'X', status: 'ativa', plano: 'gratis', papel: 'admin' } } },
    });
    expect(tela.chamadas[0].headers['X-Kentro-Usuario-Nome']).toBe(encodeURIComponent('Zoë 🛍️'));
  });

  it('chave de atendimento no campo de admin avisa e mantém as chaves guardadas', async () => {
    const tela = await montarTela('admin/config.html', {
      config: { api_url: 'https://api.teste', chave_admin: 'ksk_1' },
      storage: { chaves_pendentes: { ...registro } },
      respostas: { 'GET /v1/loja': { status: 200, body: { id: 'l1', nome: 'Loja X', status: 'ativa', plano: 'gratis', papel: 'atendimento' } } },
    });
    expect(tela.texto('aviso')).toBe(
      'Você colou a chave de atendimento no campo Chave de admin. Cole a Chave de admin na configuração do Kentro Shop — Admin.',
    );
    expect(tela.visivel('status')).toBe(false);
    expect(tela.storage.chaves_pendentes).toMatchObject({ chaveAdmin: 'ksa_1' });
    expect(tela.visivel('chaves')).toBe(true);
  });

  it('chave de admin recusada com chaves guardadas mostra as chaves em vez de criar outra loja', async () => {
    const tela = await montarTela('admin/config.html', {
      config: { api_url: 'https://api.teste', chave_admin: 'ksa_errada' },
      storage: { chaves_pendentes: { ...registro } },
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
    });
    expect(tela.texto('aviso')).toBe(
      'A chave de admin é inválida. Cole a chave correta na configuração da extensão ou crie uma loja nova.',
    );
    expect(tela.visivel('chaves')).toBe(true);
    expect(tela.visivel('btn-criar')).toBe(false);
    expect(tela.texto('valor-chave-admin')).toBe('ksa_1');
  });

  it('chave de admin recusada explica e oferece criar outra loja', async () => {
    const tela = await montarTela('admin/config.html', {
      config: { api_url: 'https://api.teste', chave_admin: 'ksa_errada' },
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
    });
    expect(tela.texto('aviso')).toBe(
      'A chave de admin é inválida. Cole a chave correta na configuração da extensão ou crie uma loja nova.',
    );
    expect(tela.visivel('btn-criar')).toBe(true);
  });
});
