import { montarTela, OpcoesTela } from './omni-falso';

const config = { api_url: 'https://api.teste', chave_admin: 'ksa_1' };
const loja = { status: 200, body: { id: 'l1', nome: 'Loja X', status: 'pendente_integracao', plano: 'gratis', papel: 'admin' } };
const conectores = {
  status: 200,
  body: [
    {
      id: 'ecommercenet',
      nome: 'eCommerce-net',
      capacidades: { buscaTextual: true, categorias: true, variacoes: true, estoque: true, relacionados: true, cotarFrete: false, criarPedido: false, oauth: false },
      camposDeCredencial: [
        { chave: 'url_api', rotulo: 'Endereço da API', tipo: 'url', obrigatorio: true, ajuda: 'Do painel da loja.' },
        { chave: 'client_id', rotulo: 'Client ID', tipo: 'texto', obrigatorio: true },
        { chave: 'client_secret', rotulo: 'Client Secret', tipo: 'segredo', obrigatorio: true },
      ],
    },
  ],
};
const integracaoOk = {
  status: 200,
  body: { plataforma: 'ecommercenet', status: 'ok', ultimoTesteEm: null, ultimoErro: null, credenciais: { url_api: 'https://x/api', client_id: 'abc', client_secret: '••••' } },
};
const semIntegracao = { status: 404, body: { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Esta loja ainda não configurou a integração.' } } };
const produtos = {
  status: 200,
  body: {
    pagina: 1,
    porPagina: 24,
    temMais: false,
    itens: Array.from({ length: 6 }, (_, i) => ({ id: `P${i}`, sku: `P${i}`, nome: `Produto ${i}`, preco: 10 + i, variacoes: [], imagens: [] })),
  },
};

const espacos = (t: string) => t.replace(/\s+/g, ' ');

function tela(respostas: OpcoesTela['respostas'], extra: Partial<OpcoesTela> = {}) {
  return montarTela('admin/config.html', {
    config,
    respostas: { 'GET /v1/loja': loja, 'GET /v1/conectores': conectores, ...respostas },
    ...extra,
  });
}

describe('aba Integração', () => {
  it('sem integração mostra o formulário gerado pelos campos do conector', async () => {
    const t = await tela({ 'GET /v1/loja/integracao': semIntegracao });
    expect(t.texto('status')).toBe('Loja Loja X · Integração: não configurada');
    expect(t.valor('plataforma')).toBe('ecommercenet');
    const segredo = t.document.getElementById('campo-client_secret') as HTMLInputElement;
    expect(segredo.type).toBe('password');
    expect((t.document.getElementById('campo-url_api') as HTMLInputElement).type).toBe('url');
    expect(t.valor('campo-client_id')).toBe('');
    expect(t.texto('campos')).toContain('Do painel da loja.');
  });

  it('com integração funcionando preenche o formulário, lista capacidades e mostra a prévia', async () => {
    const t = await tela({ 'GET /v1/loja/integracao': integracaoOk, 'GET /v1/loja/catalogo/produtos': produtos });
    expect(t.texto('status')).toBe('Loja Loja X · Integração: funcionando');
    expect(t.valor('campo-url_api')).toBe('https://x/api');
    expect(t.valor('campo-client_secret')).toBe('••••');
    const capacidades = Array.from(t.document.querySelectorAll('#capacidades li')).map((li) => li.textContent);
    expect(capacidades).toEqual(['Busca', 'Categorias', 'Variações', 'Estoque', 'Produtos relacionados']);
    const itens = Array.from(t.document.querySelectorAll('#previa li')).map((li) => espacos(li.textContent ?? ''));
    expect(itens).toHaveLength(5);
    expect(itens[0]).toBe('Produto 0 — R$ 10,00');
  });

  it('salva as credenciais aparadas e reenvia a máscara do segredo não alterado', async () => {
    const t = await tela({ 'GET /v1/loja/integracao': integracaoOk, 'GET /v1/loja/catalogo/produtos': produtos, 'PUT /v1/loja/integracao': integracaoOk });
    t.preencher('campo-url_api', '  https://nova/api ');
    await t.clicar('btn-salvar-integracao');
    const put = t.chamadas.find((c) => c.method === 'PUT')!;
    expect(JSON.parse(put.body!)).toEqual({
      plataforma: 'ecommercenet',
      credenciais: { url_api: 'https://nova/api', client_id: 'abc', client_secret: '••••' },
    });
    expect(t.texto('resultado-teste')).toBe('Integração salva. Agora clique em Testar conexão.');
    expect(t.texto('status')).toBe('Loja Loja X · Integração: pendente');
  });

  it('teste de conexão ok mostra a mensagem, as capacidades e a prévia', async () => {
    const t = await tela({
      'GET /v1/loja/integracao': semIntegracao,
      'POST /v1/loja/integracao/testar': { status: 200, body: { ok: true } },
      'GET /v1/loja/catalogo/produtos': produtos,
    });
    await t.clicar('btn-testar');
    expect(t.texto('resultado-teste')).toBe('Conexão funcionando: eCommerce-net.');
    expect(t.texto('status')).toBe('Loja Loja X · Integração: funcionando');
    expect(t.document.querySelectorAll('#previa li')).toHaveLength(5);
    expect(t.visivel('capacidades')).toBe(true);
  });

  it('teste de conexão com falha explica o motivo', async () => {
    const t = await tela({
      'GET /v1/loja/integracao': integracaoOk,
      'GET /v1/loja/catalogo/produtos': produtos,
      'POST /v1/loja/integracao/testar': { status: 200, body: { ok: false, mensagem: 'Token recusado.' } },
    });
    await t.clicar('btn-testar');
    expect(t.texto('resultado-teste')).toBe('A conexão falhou: Token recusado.');
    expect(t.texto('status')).toBe('Loja Loja X · Integração: com erro');
  });

  it('prévia sem integração não quebra a tela', async () => {
    const t = await tela({
      'GET /v1/loja/integracao': integracaoOk,
      'GET /v1/loja/catalogo/produtos': { status: 409, body: { erro: { codigo: 'SEM_INTEGRACAO', mensagem: 'x' } } },
    });
    expect(t.texto('previa')).toBe('Salve e teste a integração para ver a prévia.');
    expect(t.valor('campo-client_id')).toBe('abc');
  });

  function preencherTudo(t: Awaited<ReturnType<typeof tela>>) {
    t.preencher('campo-url_api', 'https://x/api');
    t.preencher('campo-client_id', 'abc');
    t.preencher('campo-client_secret', 's3');
  }

  it('mostra a mensagem de validação da API ao salvar (proxy que resolve com erro)', async () => {
    const t = await tela(
      {
        'GET /v1/loja/integracao': semIntegracao,
        'PUT /v1/loja/integracao': { status: 400, body: { erro: { codigo: 'ENTRADA_INVALIDA', mensagem: 'O campo Endereço da API precisa começar com https://.' } } },
      },
      { proxy: 'resolve' },
    );
    preencherTudo(t);
    await t.clicar('btn-salvar-integracao');
    expect(t.texto('resultado-teste')).toBe('O campo Endereço da API precisa começar com https://.');
    expect(t.texto('status')).toBe('Loja Loja X · Integração: não configurada');
  });

  it('campo obrigatório vazio é avisado na tela, sem chamar a API', async () => {
    const t = await tela({ 'GET /v1/loja/integracao': semIntegracao });
    t.preencher('campo-url_api', 'https://x/api');
    await t.clicar('btn-salvar-integracao');
    expect(t.texto('resultado-teste')).toBe('Preencha o campo Client ID.');
    expect(t.chamadas.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('atrás do proxy real (sem corpo nos erros) as mensagens vêm pelo status', async () => {
    const recusa = await tela(
      { 'GET /v1/loja/integracao': semIntegracao, 'PUT /v1/loja/integracao': { status: 400, body: {} } },
      { proxy: 'kentro' },
    );
    preencherTudo(recusa);
    await recusa.clicar('btn-salvar-integracao');
    expect(recusa.texto('resultado-teste')).toBe('Confira os campos da integração.');

    const semSalvar = await tela(
      { 'GET /v1/loja/integracao': semIntegracao, 'POST /v1/loja/integracao/testar': { status: 409, body: {} } },
      { proxy: 'kentro' },
    );
    await semSalvar.clicar('btn-testar');
    expect(semSalvar.texto('resultado-teste')).toBe('Salve a integração antes de testar.');

    const foraDoAr = await tela(
      { 'GET /v1/loja/integracao': integracaoOk, 'GET /v1/loja/catalogo/produtos': produtos, 'POST /v1/loja/integracao/testar': { status: 502, body: {} } },
      { proxy: 'kentro' },
    );
    await foraDoAr.clicar('btn-testar');
    expect(foraDoAr.texto('resultado-teste')).toBe('A plataforma de e-commerce não respondeu. Tente de novo em instantes.');
  });

  it('testar depois de editar o formulário salva antes, para testar o que está na tela', async () => {
    const t = await tela({
      'GET /v1/loja/integracao': integracaoOk,
      'GET /v1/loja/catalogo/produtos': produtos,
      'PUT /v1/loja/integracao': integracaoOk,
      'POST /v1/loja/integracao/testar': { status: 200, body: { ok: true } },
    });
    t.preencher('campo-client_id', 'novo-id');
    t.document.getElementById('campo-client_id')!.dispatchEvent(new t.document.defaultView!.Event('input'));
    await t.clicar('btn-testar');
    const ordem = t.chamadas.filter((c) => c.method !== 'GET').map((c) => c.method);
    expect(ordem).toEqual(['PUT', 'POST']);
    expect(JSON.parse(t.chamadas.find((c) => c.method === 'PUT')!.body!).credenciais.client_id).toBe('novo-id');
    expect(t.texto('resultado-teste')).toBe('Conexão funcionando: eCommerce-net.');
  });

  it('testar sem editar não salva de novo', async () => {
    const t = await tela({
      'GET /v1/loja/integracao': integracaoOk,
      'GET /v1/loja/catalogo/produtos': produtos,
      'POST /v1/loja/integracao/testar': { status: 200, body: { ok: true } },
    });
    await t.clicar('btn-testar');
    expect(t.chamadas.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('integração inexistente vinda do proxy da Kentro (not_found) conta como não configurada', async () => {
    const t = await tela({ 'GET /v1/loja/integracao': semIntegracao }, { proxy: 'kentro' });
    expect(t.texto('status')).toBe('Loja Loja X · Integração: não configurada');
    expect(t.visivel('aba-integracao')).toBe(true);
  });
});

describe('telas com o proxy da Kentro devolvendo erros de outras formas', () => {
  it('painel: 401 resolvido não é confundido com chave de admin', async () => {
    const t = await montarTela('atendimento/painel.html', {
      config: { api_url: 'https://api.teste', chave_atendimento: 'ksk_x' },
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
      proxy: 'resolve',
    });
    expect(t.texto('aviso')).toBe(
      'A chave de atendimento do Kentro Shop é inválida. Peça ao administrador para conferir a configuração.',
    );
  });

  it('painel: 401 convertido em forbidden pela Kentro avisa para conferir a chave', async () => {
    const t = await montarTela('atendimento/painel.html', {
      config: { api_url: 'https://api.teste', chave_atendimento: 'ksk_x' },
      respostas: { 'GET /v1/loja': { status: 401, body: {} } },
      proxy: 'kentro',
    });
    expect(t.texto('aviso')).toBe(
      'A Kentro recusou a chamada ao Kentro Shop. Peça ao administrador para conferir a chave de atendimento e a permissão de chamadas externas.',
    );
  });

  it('admin: 401 resolvido mostra chave inválida', async () => {
    const t = await montarTela('admin/config.html', {
      config,
      respostas: { 'GET /v1/loja': { status: 401, body: { erro: { codigo: 'CHAVE_INVALIDA', mensagem: 'x' } } } },
      proxy: 'resolve',
    });
    expect(t.texto('aviso')).toBe(
      'A chave de admin é inválida. Cole a chave correta na configuração da extensão ou crie uma loja nova.',
    );
  });
});
