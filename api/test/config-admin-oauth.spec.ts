import { montarTela, OpcoesTela, Tela } from './omni-falso';

// Plataforma com OAuth (Nuvemshop) na tela de admin: botão "Conectar" no lugar do formulário.

const config = { api_url: 'https://api.teste', chave_admin: 'ksa_1' };
const loja = { status: 200, body: { id: 'l1', nome: 'Loja X', status: 'pendente_integracao', plano: 'gratis', papel: 'admin' } };
const conectores = {
  status: 200,
  body: [
    { id: 'falso', nome: 'Falso', capacidades: { buscaTextual: true }, camposDeCredencial: [{ chave: 'token', rotulo: 'Token', tipo: 'segredo', obrigatorio: true }] },
    { id: 'nuvemshop', nome: 'Nuvemshop', capacidades: { buscaTextual: true, categorias: true, variacoes: true, oauth: true, criarPedido: true }, camposDeCredencial: [] },
  ],
};
const semIntegracao = { status: 404, body: { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Esta loja ainda não configurou a integração.' } } };
const conectada = { status: 200, body: { plataforma: 'nuvemshop', status: 'ok', ultimoTesteEm: '2026-10-20T12:00:00.000Z', ultimoErro: null, credenciais: {}, conectada: true } };
const link = { status: 200, body: { url: 'https://www.nuvemshop.com.br/apps/47447/authorize?state=abc' } };
const produtos = { status: 200, body: { pagina: 1, porPagina: 24, temMais: false, itens: [{ id: '1', sku: 'A', nome: 'Porcelanato', preco: 10, variacoes: [], imagens: [] }] } };

function tela(respostas: OpcoesTela['respostas']) {
  return montarTela('admin/config.html', {
    config,
    intervaloMs: 20,
    respostas: { 'GET /v1/loja': loja, 'GET /v1/conectores': conectores, 'POST /v1/loja/integracao/oauth/iniciar': link, 'GET /v1/loja/catalogo/produtos': produtos, ...respostas },
  });
}

function escolher(t: Tela, plataforma: string) {
  const select = t.document.getElementById('plataforma') as HTMLSelectElement;
  select.value = plataforma;
  select.dispatchEvent(new t.document.defaultView!.Event('change', { bubbles: true }));
}

describe('aba Integração: Nuvemshop (OAuth)', () => {
  let t: Tela;
  afterEach(() => t?.fechar());

  it('sem formulário nem "Salvar": mostra o botão Conectar', async () => {
    t = await tela({ 'GET /v1/loja/integracao': semIntegracao });
    escolher(t, 'nuvemshop');
    expect(t.visivel('bloco-oauth')).toBe(true);
    expect(t.visivel('btn-salvar-integracao')).toBe(false);
    expect(t.document.querySelectorAll('#campos input')).toHaveLength(0);
    expect(t.texto('btn-conectar')).toBe('Conectar Nuvemshop');
    escolher(t, 'falso');
    expect(t.visivel('bloco-oauth')).toBe(false);
    expect(t.visivel('btn-salvar-integracao')).toBe(true);
  });

  it('Conectar copia o link (sem abrir aba pelo iframe) e, quando a autorização volta, mostra a conexão funcionando', async () => {
    t = await tela({ 'GET /v1/loja/integracao': semIntegracao });
    escolher(t, 'nuvemshop');
    const abertas: unknown[] = [];
    t.document.defaultView!.open = (...a: unknown[]) => (abertas.push(a), null);
    await t.clicar('btn-conectar');
    const pedido = t.chamadas.find((c) => c.url.endsWith('/v1/loja/integracao/oauth/iniciar'))!;
    expect(JSON.parse(pedido.body!)).toEqual({ plataforma: 'nuvemshop' });
    expect(t.copiados).toEqual([link.body.url]);
    // A aba aberta pelo iframe da Kentro herdaria o sandbox, e o login da Nuvemshop não carrega nela.
    expect(abertas).toHaveLength(0);
    expect(t.document.querySelector('#bloco-oauth a[href]')).toBeNull();
    expect(t.visivel('oauth-link-caixa')).toBe(true);
    expect(t.texto('oauth-estado')).toBe('Aguardando a autorização na Nuvemshop…');

    await t.clicar('btn-copiar-oauth');
    expect(t.copiados).toEqual([link.body.url, link.body.url]);

    // O lojista autoriza na Nuvemshop: o retorno grava e testa; a tela percebe na próxima conferência.
    t.respostas['GET /v1/loja/integracao'] = conectada;
    await t.esperar(60);
    expect(t.texto('resultado-teste')).toBe('Conexão funcionando: Nuvemshop.');
    expect(t.texto('status')).toBe('Loja Loja X · Integração: funcionando');
    expect(t.texto('btn-conectar')).toBe('Conectar de novo');
    expect(t.visivel('bloco-capacidades')).toBe(true);
  });

  it('aba Pedidos: com a Nuvemshop, oferece criar o pedido na loja e salva o modo', async () => {
    const configuracoes = {
      status: 200,
      body: {
        tema: { nome: 'Loja X', corPrimaria: '#7c3aed' },
        entrega: { habilitada: true },
        retirada: { habilitada: false },
        lojasRetirada: [],
        frete: { regra: 'a_combinar' },
        mostrarPrecos: true,
        expiracaoLinkDias: 7,
        modoPedido: 'handoff',
        categoriasOcultas: [],
      },
    };
    t = await tela({ 'GET /v1/loja/integracao': conectada, 'GET /v1/loja/configuracoes': configuracoes, 'PATCH /v1/loja/configuracoes': configuracoes });
    await t.esperar(5);
    await t.clicar('botao-aba-pedidos');
    expect(t.visivel('bloco-modo-pedido')).toBe(true);
    expect(t.texto('pd-criar-titulo')).toBe('Criar o pedido na Nuvemshop, com link de pagamento');
    expect((t.document.getElementById('pd-criar-pedido') as HTMLInputElement).checked).toBe(false);
    (t.document.getElementById('pd-criar-pedido') as HTMLInputElement).checked = true;
    await t.clicar('btn-salvar-pedidos');
    const patch = t.chamadas.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body!)).toEqual({ mostrarPrecos: true, expiracaoLinkDias: 7, modoPedido: 'criar_pedido' });
  });

  it('já conectada ao abrir: diz que está conectada', async () => {
    t = await tela({ 'GET /v1/loja/integracao': conectada });
    expect(t.visivel('bloco-oauth')).toBe(true);
    expect(t.texto('oauth-estado')).toMatch(/^Loja conectada\./);
    expect(t.texto('btn-conectar')).toBe('Conectar de novo');
  });
});
