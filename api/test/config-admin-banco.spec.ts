import { montarTela, OpcoesTela, Tela } from './omni-falso';

// Banco de dados do ERP na tela de admin: campos do banco; a API lê os produtos e guarda a cópia.

const config = { api_url: 'https://api.teste', chave_admin: 'ksa_1' };
const loja = { status: 200, body: { id: 'l1', nome: 'Farmácia X', status: 'pendente_integracao', plano: 'gratis', papel: 'admin' } };
const CAMPOS = [
  { chave: 'host', rotulo: 'Servidor do banco', tipo: 'texto', obrigatorio: true },
  { chave: 'porta', rotulo: 'Porta', tipo: 'texto', obrigatorio: false },
  { chave: 'usuario', rotulo: 'Usuário', tipo: 'texto', obrigatorio: true },
  { chave: 'senha', rotulo: 'Senha', tipo: 'segredo', obrigatorio: true },
  { chave: 'banco', rotulo: 'Banco', tipo: 'texto', obrigatorio: false },
];
const conectores = {
  status: 200,
  body: [
    { id: 'falso', nome: 'Falso', capacidades: { buscaTextual: true }, camposDeCredencial: [{ chave: 'token', rotulo: 'Token', tipo: 'segredo', obrigatorio: true }] },
    { id: 'automatiza', nome: 'ERP Automatiza (banco de dados)', capacidades: { buscaTextual: true, categorias: true, estoque: true }, camposDeCredencial: CAMPOS, sincronizacao: { minutos: 15 } },
  ],
};
const credenciais = { host: 'banco.erp.teste', porta: '9534', usuario: 'delivery', senha: '••••' };
const bancoSalvo = { status: 200, body: { plataforma: 'automatiza', status: 'pendente', ultimoTesteEm: null, ultimoErro: null, credenciais } };
const semIntegracao = { status: 404, body: { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Esta loja ainda não configurou a integração.' } } };
const nuncaSincronizado = { status: 200, body: { sincronizadoEm: null, total: 0, categorias: 0, sincronizando: false, ultimoErro: null, ultimoErroEm: null } };
const sincronizado = { status: 200, body: { sincronizadoEm: new Date().toISOString(), total: 6562, categorias: 39, sincronizando: false, ultimoErro: null, ultimoErroEm: null } };
const testeOk = { status: 200, body: { ok: true, nomeLoja: 'FARMACIA TESTE - LOJA07 (6562 produtos)' } };

const sincronizacoes = (t: Tela) => t.chamadas.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/loja/catalogo-sincronizado/sincronizar'));

function tela(respostas: OpcoesTela['respostas'], extra: Partial<OpcoesTela> = {}) {
  return montarTela('admin/config.html', {
    config,
    respostas: {
      'GET /v1/loja': loja,
      'GET /v1/conectores': conectores,
      'GET /v1/loja/catalogo-sincronizado': nuncaSincronizado,
      'POST /v1/loja/catalogo-sincronizado/sincronizar': sincronizado,
      'POST /v1/loja/integracao/testar': testeOk,
      ...respostas,
    },
    ...extra,
  });
}

describe('aba Integração: banco de dados do ERP', () => {
  let t: Tela;
  afterEach(() => t?.fechar());

  it('escolher o banco mostra os campos e o bloco de sincronização, ainda sem buscar nada', async () => {
    t = await tela({ 'GET /v1/loja/integracao': semIntegracao });
    const select = t.document.getElementById('plataforma') as HTMLSelectElement;
    select.value = 'automatiza';
    select.dispatchEvent(new t.document.defaultView!.Event('change', { bubbles: true }));
    expect([...t.document.querySelectorAll('#campos input')].map((i) => (i as HTMLInputElement).id)).toEqual(CAMPOS.map((c) => `campo-${c.chave}`));
    expect((t.document.getElementById('campo-senha') as HTMLInputElement).type).toBe('password');
    expect(t.visivel('bloco-banco')).toBe(true);
    expect(t.visivel('bloco-kentro')).toBe(false);
    expect(t.texto('banco-estado')).toBe('Salve a integração para buscar os produtos do banco de dados.');
    expect(t.texto('banco-ajuda')).toMatch(/a cada 15 minutos.*controlados ficam de fora/);
    expect(sincronizacoes(t)).toHaveLength(0);
  });

  it('salvar grava os campos, sincroniza na API e testa a integração', async () => {
    t = await tela({ 'GET /v1/loja/integracao': semIntegracao, 'PUT /v1/loja/integracao': bancoSalvo });
    const select = t.document.getElementById('plataforma') as HTMLSelectElement;
    select.value = 'automatiza';
    select.dispatchEvent(new t.document.defaultView!.Event('change', { bubbles: true }));
    t.preencher('campo-host', 'banco.erp.teste');
    t.preencher('campo-porta', '9534');
    t.preencher('campo-usuario', 'delivery');
    t.preencher('campo-senha', 'segredo');

    await t.clicar('btn-salvar-integracao');
    await t.esperar(20);
    const put = t.chamadas.find((c) => c.method === 'PUT' && c.url.endsWith('/v1/loja/integracao'))!;
    expect(JSON.parse(put.body!)).toEqual({
      plataforma: 'automatiza',
      credenciais: { host: 'banco.erp.teste', porta: '9534', usuario: 'delivery', senha: 'segredo', banco: '' },
    });
    expect(sincronizacoes(t)).toHaveLength(1);
    expect(t.texto('banco-estado')).toMatch(/^6562 produtos · 39 categorias · sincronizado hoje às \d\d:\d\d$/);
    expect(t.texto('resultado-teste')).toBe('Conexão funcionando: FARMACIA TESTE - LOJA07 (6562 produtos).');
  });

  it('abrir a tela não sincroniza sozinho (a API renova a cópia) e mostra o estado e a falha da última tentativa', async () => {
    const comFalha = { status: 200, body: { ...sincronizado.body, ultimoErro: 'A plataforma recusou as credenciais. Confira os dados da integração.' } };
    t = await tela({ 'GET /v1/loja/integracao': bancoSalvo, 'GET /v1/loja/catalogo-sincronizado': comFalha });
    await t.esperar(20);
    expect(sincronizacoes(t)).toHaveLength(0);
    expect(t.texto('banco-estado')).toMatch(/^6562 produtos · 39 categorias · sincronizado hoje às \d\d:\d\d · a última tentativa falhou: A plataforma recusou as credenciais/);
  });

  it('Sincronizar agora com erro mostra a mensagem da API', async () => {
    const recusado = { status: 422, body: { erro: { codigo: 'RECUSADO_PELA_PLATAFORMA', mensagem: 'O usuário do banco não tem acesso a uma das views necessárias (ou ela não existe).' } } };
    t = await tela({ 'GET /v1/loja/integracao': bancoSalvo, 'POST /v1/loja/catalogo-sincronizado/sincronizar': recusado });
    await t.esperar(10);
    await t.clicar('btn-sincronizar-banco');
    await t.esperar(20);
    expect(t.texto('banco-estado')).toBe('O usuário do banco não tem acesso a uma das views necessárias (ou ela não existe).');
    expect((t.document.getElementById('btn-sincronizar-banco') as HTMLButtonElement).disabled).toBe(false);
  });

  it('erro sem corpo atrás do proxy da Kentro: mostra o motivo gravado no estado', async () => {
    const falhou = { status: 200, body: { ...nuncaSincronizado.body, ultimoErro: 'A plataforma de e-commerce não respondeu. Tente de novo em instantes.' } };
    t = await tela(
      {
        'GET /v1/loja/integracao': bancoSalvo,
        'GET /v1/loja/catalogo-sincronizado': falhou,
        'POST /v1/loja/catalogo-sincronizado/sincronizar': { status: 502, body: { erro: { codigo: 'PLATAFORMA_INDISPONIVEL', mensagem: 'x' } } },
      },
      { proxy: 'kentro' },
    );
    await t.esperar(10);
    await t.clicar('btn-sincronizar-banco');
    await t.esperar(20);
    expect(t.texto('banco-estado')).toBe('Ainda não sincronizado. A última tentativa falhou: A plataforma de e-commerce não respondeu. Tente de novo em instantes.');
  });

  it('outra plataforma não mostra o bloco do banco', async () => {
    t = await tela({ 'GET /v1/loja/integracao': { status: 200, body: { plataforma: 'falso', status: 'ok', credenciais: { token: '••••' } } } });
    await t.esperar(5);
    expect(t.visivel('bloco-banco')).toBe(false);
  });
});
