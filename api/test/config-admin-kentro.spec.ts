import { montarTela, OpcoesTela, Tela } from './omni-falso';

// Catálogo da Kentro na tela de admin: sem campos de credencial; a extensão lê os produtos e envia a cópia.

const config = { api_url: 'https://api.teste', chave_admin: 'ksa_1' };
const loja = { status: 200, body: { id: 'l1', nome: 'Loja X', status: 'pendente_integracao', plano: 'gratis', papel: 'admin' } };
const conectores = {
  status: 200,
  body: [
    { id: 'falso', nome: 'Falso', capacidades: { buscaTextual: true }, camposDeCredencial: [{ chave: 'token', rotulo: 'Token', tipo: 'segredo', obrigatorio: true }] },
    { id: 'kentro', nome: 'Catálogo da Kentro', capacidades: { buscaTextual: true, categorias: true }, camposDeCredencial: [] },
  ],
};
const kentroSalva = { status: 200, body: { plataforma: 'kentro', status: 'pendente', ultimoTesteEm: null, ultimoErro: null, credenciais: {} } };
const semIntegracao = { status: 404, body: { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Esta loja ainda não configurou a integração.' } } };
const estadoCopia = { status: 200, body: { sincronizadoEm: new Date().toISOString(), total: 2, categorias: 1, sincronizando: false } };
const loteOk = { status: 200, body: { recebidos: 2, total: 2, sincronizadoEm: new Date().toISOString() } };
const testeOk = { status: 200, body: { ok: true, nomeLoja: 'Catálogo da Kentro (2 produtos)' } };

// Como omni.products.list entrega (campos a mais, como currency, não vão para a API).
const PRODUTOS = [
  { id: 1, name: 'Porcelanato Bege', description: 'Caixa 1,44 m²', internalCode: 'PRC-1', value: 119.9, price: 119.9, currency: 'BRL', measurementUnit: 'cx', groupIds: [1], available: true, hiddenFromClients: false, imageUrl: 'https://cdn/p.jpg' },
  { id: 2, name: 'Argamassa', value: 39.9, price: 39.9, groupIds: [1], available: true, hiddenFromClients: false },
];

const lotes = (t: Tela) => t.chamadas.filter((c) => c.url.endsWith('/v1/loja/catalogo-kentro/lotes')).map((c) => JSON.parse(c.body!));

function tela(respostas: OpcoesTela['respostas'], extra: Partial<OpcoesTela> = {}) {
  return montarTela('admin/config.html', {
    config,
    produtos: PRODUTOS,
    dados: { productgroups: [{ id: 1, name: 'Pisos' }] },
    respostas: {
      'GET /v1/loja': loja,
      'GET /v1/conectores': conectores,
      'GET /v1/loja/catalogo-kentro': estadoCopia,
      'POST /v1/loja/catalogo-kentro/lotes': loteOk,
      'POST /v1/loja/integracao/testar': testeOk,
      ...respostas,
    },
    ...extra,
  });
}

describe('aba Integração: catálogo da Kentro', () => {
  let t: Tela;
  afterEach(() => t?.fechar());

  it('abrir a tela sincroniza sozinho: sem campos, envia os produtos e os grupos e testa a integração', async () => {
    t = await tela({ 'GET /v1/loja/integracao': kentroSalva });
    await t.esperar(20);
    expect(t.document.querySelectorAll('#campos input')).toHaveLength(0);
    expect(t.visivel('bloco-kentro')).toBe(true);
    expect(lotes(t)).toEqual([
      {
        lote: expect.stringMatching(/^k[a-z0-9]{8,}$/),
        parte: 0,
        ultima: true,
        produtos: [
          { id: 1, name: 'Porcelanato Bege', description: 'Caixa 1,44 m²', internalCode: 'PRC-1', price: 119.9, measurementUnit: 'cx', groupIds: [1], available: true, hiddenFromClients: false, imageUrl: 'https://cdn/p.jpg' },
          { id: 2, name: 'Argamassa', description: '', price: 39.9, groupIds: [1], available: true, hiddenFromClients: false },
        ],
        grupos: [{ id: 1, nome: 'Pisos' }],
      },
    ]);
    expect(t.texto('kentro-estado')).toMatch(/^2 produtos · 1 categoria · sincronizado hoje às \d\d:\d\d$/);
    expect(t.texto('resultado-teste')).toBe('Conexão funcionando: Catálogo da Kentro (2 produtos).');
    expect(t.texto('status')).toBe('Loja Loja X · Integração: funcionando');
  });

  it('escolher a Kentro e salvar grava sem credenciais e já busca os produtos', async () => {
    t = await tela({ 'GET /v1/loja/integracao': semIntegracao, 'PUT /v1/loja/integracao': kentroSalva });
    const select = t.document.getElementById('plataforma') as HTMLSelectElement;
    select.value = 'kentro';
    select.dispatchEvent(new t.document.defaultView!.Event('change', { bubbles: true }));
    expect(t.visivel('bloco-kentro')).toBe(true);
    expect(t.texto('kentro-estado')).toBe('Salve a integração para buscar os produtos da Kentro.');
    expect(lotes(t)).toHaveLength(0);

    await t.clicar('btn-salvar-integracao');
    await t.esperar(20);
    const put = t.chamadas.find((c) => c.method === 'PUT' && c.url.endsWith('/v1/loja/integracao'))!;
    expect(JSON.parse(put.body!)).toEqual({ plataforma: 'kentro', credenciais: {} });
    expect(lotes(t)).toHaveLength(1);
  });

  it('sem os nomes dos grupos, envia os produtos sem o campo grupos (a API mantém os anteriores)', async () => {
    t = await tela({ 'GET /v1/loja/integracao': kentroSalva }, { dados: {} });
    await t.esperar(20);
    expect(lotes(t)[0]).not.toHaveProperty('grupos');
  });

  it('SDK sem products explica em vez de enviar', async () => {
    t = await tela({ 'GET /v1/loja/integracao': kentroSalva }, { produtos: undefined });
    await t.esperar(20);
    expect(lotes(t)).toHaveLength(0);
    expect(t.texto('kentro-estado')).toBe('Esta versão da Kentro não deixa a extensão ler os produtos.');
  });

  it('409 sem corpo atrás do proxy da Kentro: explica que já há sincronização em andamento', async () => {
    t = await tela(
      { 'GET /v1/loja/integracao': kentroSalva, 'POST /v1/loja/catalogo-kentro/lotes': { status: 409, body: { erro: { codigo: 'SINCRONIZANDO', mensagem: 'x' } } } },
      { proxy: 'kentro' },
    );
    await t.esperar(20);
    expect(t.texto('kentro-estado')).toBe('Não foi possível sincronizar agora: já há uma sincronização em andamento. Tente de novo em instantes.');
  });

  it('outra plataforma não mostra o bloco da Kentro', async () => {
    t = await tela({ 'GET /v1/loja/integracao': { status: 200, body: { plataforma: 'falso', status: 'ok', credenciais: { token: '••••' } } } });
    await t.esperar(5);
    expect(t.visivel('bloco-kentro')).toBe(false);
    expect(lotes(t)).toHaveLength(0);
  });
});
