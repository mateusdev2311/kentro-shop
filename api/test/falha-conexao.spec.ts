import { montarTela } from './omni-falso';

// A API fora do ar por instantes não pode travar as telas: elas continuam de pé e o motivo vai num aviso flutuante.

const FORA = { code: 'timeout', message: 'sem resposta' };

const conector = {
  id: 'demonstracao',
  nome: 'Demonstração',
  capacidades: {},
  camposDeCredencial: [{ chave: 'loja', rotulo: 'Loja', tipo: 'texto', obrigatorio: false }],
};
const configuracoes = {
  tema: { nome: 'Farmácia X', corPrimaria: '#123456' },
  entrega: { habilitada: true },
  retirada: { habilitada: false },
  lojasRetirada: [],
  frete: { regra: 'a_combinar' },
  mostrarPrecos: true,
  expiracaoLinkDias: 9,
};
const lojaAdmin = { id: 'l1', nome: 'Farmácia X', status: 'ativa', plano: 'gratis', papel: 'admin' };
const integracao = { plataforma: 'demonstracao', status: 'pendente', credenciais: { loja: 'filial 8' } };
const ultimosDados = { chave: 'ksa_01'.slice(-6), loja: lojaAdmin, conectores: [conector], integracao, configuracoes };
const configAdmin = { api_url: 'https://api.teste', chave_admin: 'ksa_01' };
const respostasAdmin = {
  'GET /v1/loja': { status: 200, body: lojaAdmin },
  'GET /v1/conectores': { status: 200, body: [conector] },
  'GET /v1/loja/integracao': { status: 200, body: integracao },
  'GET /v1/loja/configuracoes': { status: 200, body: configuracoes },
};

describe('tela do admin com a API fora do ar', () => {
  it('abre as abas e mostra o motivo no aviso flutuante, sem a faixa de erro travando a tela', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: FORA });
    expect(tela.visivel('loja')).toBe(true);
    expect(tela.visivel('carregando')).toBe(false);
    expect(tela.visivel('aviso')).toBe(false);
    expect(tela.visivel('pop-erro')).toBe(true);
    expect(tela.texto('pop-titulo')).toBe('Sem conexão com o Kentro Shop');
    expect(tela.texto('pop-texto')).toContain('ficou sem resposta até o tempo limite');
    expect(tela.texto('pop-detalhe')).toMatch(/^Detalhe: timeout · GET \/v1\/loja · \d+,\d s · sem resposta$/);
    expect(tela.texto('status')).toBe('Sem conexão: tentando de novo…');
  });

  it('dá para trocar de aba e fechar o aviso', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: FORA });
    await tela.clicar('botao-aba-pedidos');
    expect(tela.visivel('aba-pedidos')).toBe(true);
    await tela.clicar('pop-fechar');
    expect(tela.visivel('pop-erro')).toBe(false);
  });

  it('sem os últimos dados não salva os valores padrão por cima da configuração real', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: FORA });
    await tela.clicar('botao-aba-pedidos');
    await tela.clicar('btn-salvar-pedidos');
    expect(tela.texto('resultado-pedidos')).toContain('nada foi salvo');
    expect(tela.chamadas.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('com os últimos dados guardados, as abas abrem preenchidas', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: FORA, storage: { ultimos_dados: ultimosDados } });
    expect(tela.valor('ap-nome')).toBe('Farmácia X');
    expect(tela.valor('pd-validade')).toBe('9');
    expect(tela.valor('plataforma')).toBe('demonstracao');
    expect(tela.valor('campo-loja')).toBe('filial 8');
    expect(tela.texto('status')).toBe('Loja Farmácia X · Sem conexão: tentando de novo…');
  });

  it('salvar sem conexão avisa e mantém o que foi digitado', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: FORA, storage: { ultimos_dados: ultimosDados } });
    tela.preencher('pd-validade', '30');
    await tela.clicar('btn-salvar-pedidos');
    expect(tela.visivel('pop-erro')).toBe(true);
    expect(tela.texto('pop-detalhe')).toContain('PATCH /v1/loja/configuracoes');
    expect(tela.visivel('pop-tentar')).toBe(false);
    expect(tela.valor('pd-validade')).toBe('30');
  });

  it('os últimos dados de outra chave não aparecem', async () => {
    const tela = await montarTela('admin/config.html', {
      config: { ...configAdmin, chave_admin: 'ksa_outra' },
      falhaHttp: FORA,
      storage: { ultimos_dados: ultimosDados },
    });
    expect(tela.valor('ap-nome')).toBe('');
  });

  it('chave recusada tira os últimos dados da tela e do navegador', async () => {
    const tela = await montarTela('admin/config.html', {
      config: configAdmin,
      storage: { ultimos_dados: ultimosDados },
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
    });
    expect(tela.visivel('loja')).toBe(false);
    expect(tela.visivel('aviso')).toBe(true);
    expect(tela.storage.ultimos_dados).toBeUndefined();
  });

  it('a leitura que falha por instantes é repetida sem aparecer erro nenhum', async () => {
    let falhas = 1;
    const tela = await montarTela('admin/config.html', {
      config: configAdmin,
      respostas: respostasAdmin,
      esperasRepetir: [1],
      falhaDinamica: () => (falhas-- > 0 ? FORA : null),
    });
    await tela.esperar(20);
    expect(tela.visivel('pop-erro')).toBe(false);
    expect(tela.texto('status')).toMatch(/^Loja Farmácia X · Integração: /);
  });

  it('gravação que falha nunca é repetida sozinha', async () => {
    let fora = false;
    const tela = await montarTela('admin/config.html', {
      config: configAdmin,
      respostas: respostasAdmin,
      esperasRepetir: [1, 1],
      falhaDinamica: () => (fora ? FORA : null),
    });
    await tela.esperar(10);
    fora = true;
    await tela.clicar('btn-salvar-pedidos');
    await tela.esperar(10);
    expect(tela.chamadas.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('quando a API volta, a tela se atualiza sozinha e o aviso some', async () => {
    let fora = true;
    const tela = await montarTela('admin/config.html', {
      config: configAdmin,
      respostas: respostasAdmin,
      reconexaoMs: 5,
      falhaDinamica: () => (fora ? FORA : null),
    });
    expect(tela.visivel('pop-erro')).toBe(true);
    fora = false;
    await tela.esperar(30);
    expect(tela.visivel('pop-erro')).toBe(false);
    expect(tela.valor('ap-nome')).toBe('Farmácia X');
    expect(tela.texto('status')).toMatch(/^Loja Farmácia X · Integração: /);
    expect(tela.storage.ultimos_dados).toMatchObject({ chave: ultimosDados.chave, loja: { nome: 'Farmácia X' } });
    tela.fechar();
  });

  it('o que foi digitado sobre os últimos dados não se perde quando a API volta', async () => {
    let fora = true;
    const tela = await montarTela('admin/config.html', {
      config: configAdmin,
      respostas: respostasAdmin,
      storage: { ultimos_dados: ultimosDados },
      reconexaoMs: 5,
      falhaDinamica: () => (fora ? FORA : null),
    });
    const campo = tela.document.getElementById('ap-nome') as HTMLInputElement;
    campo.value = 'Nome novo';
    campo.dispatchEvent(new (tela.document.defaultView as unknown as typeof globalThis).Event('input', { bubbles: true }));
    fora = false;
    await tela.esperar(30);
    expect(tela.valor('ap-nome')).toBe('Nome novo');
    expect(tela.visivel('pop-erro')).toBe(false);
    tela.fechar();
  });

  it('o aviso fechado não volta enquanto a API continua fora', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: FORA, reconexaoMs: 5 });
    await tela.clicar('pop-fechar');
    await tela.esperar(30);
    expect(tela.visivel('pop-erro')).toBe(false);
    tela.fechar();
  });

  it('a chave nunca aparece no aviso', async () => {
    const tela = await montarTela('admin/config.html', { config: configAdmin, falhaHttp: { code: 'internal', message: 'falhou com ksa_01' } });
    expect(tela.texto('pop-detalhe')).toContain('falhou com ***');
    expect(tela.document.body.textContent).not.toContain('ksa_01');
  });
});

describe('painel do atendimento com a API fora do ar', () => {
  const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_01' };
  const lojaOk = { status: 200, body: { id: 'l1', nome: 'Farmácia X', status: 'ativa', plano: 'gratis', papel: 'atendimento' } };
  const chatAberto = { id: 42, contact: { name: 'Ana', phone: '5538999990000' } };

  it('continua de pé: abre o atendimento e mostra o motivo no aviso', async () => {
    const tela = await montarTela('atendimento/painel.html', { config, falhaHttp: FORA, chat: chatAberto });
    expect(tela.visivel('carregando')).toBe(false);
    expect(tela.visivel('aviso')).toBe(false);
    expect(tela.visivel('ferramentas')).toBe(true);
    expect(tela.visivel('pop-erro')).toBe(true);
    expect(tela.texto('pop-detalhe')).toMatch(/^Detalhe: timeout · GET \//);
    expect(tela.texto('status')).toBe('Sem conexão: tentando de novo…');
    expect(tela.toasts).toContain('Sem conexão com o Kentro Shop');
  });

  it('usa as filas guardadas enquanto não há conexão', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config,
      falhaHttp: FORA,
      chat: { ...chatAberto, queueId: 9 },
      storage: { ultima_loja: { chave: 'ksk_01', nome: 'Farmácia X', filasAtendimento: [1] } },
    });
    expect(tela.visivel('fora-da-fila')).toBe(true);
  });

  it('uma consulta periódica que falha com o pedido aberto não incomoda; três seguidas avisam', async () => {
    let fora = false;
    const sessao = { id: 's1', url: 'https://x/c', status: 'navegando', itens: [], totais: { subtotal: 0, total: 0 }, expiraEm: new Date(Date.now() + 3600_000).toISOString() };
    const tela = await montarTela('atendimento/painel.html', {
      config,
      chat: chatAberto,
      intervaloMs: 60,
      respostas: {
        'GET /v1/loja': lojaOk,
        'GET /v1/sessoes/chat/42': { status: 200, body: sessao },
        'GET /v1/loja/catalogo/categorias': { status: 200, body: [] },
        'GET /v1/sessoes/opcoes-pedido': { status: 200, body: {} },
        'GET /v1/sessoes/historico': { status: 200, body: { enderecos: [], pedidos: [] } },
      },
      falhaDinamica: () => (fora ? FORA : null),
    });
    await tela.esperar(5);
    expect(tela.visivel('com-sessao')).toBe(true);
    fora = true;
    const consultas = () => tela.chamadas.filter((c) => c.url.endsWith('/v1/sessoes/chat/42')).length;
    const antes = consultas();
    while (consultas() < antes + 1) await tela.esperar(5);
    expect(tela.visivel('pop-erro')).toBe(false);
    expect(tela.visivel('com-sessao')).toBe(true);
    while (consultas() < antes + 3) await tela.esperar(5);
    expect(tela.visivel('pop-erro')).toBe(true);
    expect(tela.visivel('aviso')).toBe(false);
    fora = false;
    await tela.esperar(150);
    expect(tela.visivel('pop-erro')).toBe(false);
    expect(tela.texto('status')).toBe('Conectado à loja Farmácia X.');
    tela.fechar();
  });

  it('quando a API volta, liga na loja e lê o atendimento sozinho', async () => {
    let fora = true;
    const tela = await montarTela('atendimento/painel.html', {
      config,
      chat: chatAberto,
      reconexaoMs: 5,
      respostas: { 'GET /v1/loja': lojaOk, 'GET /v1/sessoes/chat/42': { status: 404, body: {} } },
      falhaDinamica: () => (fora ? FORA : null),
    });
    expect(tela.visivel('sem-sessao')).toBe(false);
    fora = false;
    await tela.esperar(30);
    expect(tela.visivel('pop-erro')).toBe(false);
    expect(tela.texto('status')).toBe('Conectado à loja Farmácia X.');
    expect(tela.visivel('sem-sessao')).toBe(true);
    expect(tela.storage.ultima_loja).toMatchObject({ chave: 'ksk_01', nome: 'Farmácia X' });
    tela.fechar();
  });

  it('chave recusada continua sendo erro de configuração, na faixa', async () => {
    const tela = await montarTela('atendimento/painel.html', {
      config,
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
    });
    expect(tela.visivel('aviso')).toBe(true);
    expect(tela.visivel('pop-erro')).toBe(false);
  });
});
