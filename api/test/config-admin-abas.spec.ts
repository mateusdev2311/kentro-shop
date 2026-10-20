import { montarTela, OpcoesTela, Tela } from './omni-falso';

const config = { api_url: 'https://api.teste', chave_admin: 'ksa_1' };
const loja = { status: 200, body: { id: 'l1', nome: 'Loja X', status: 'ativa', plano: 'gratis', papel: 'admin' } };
const semIntegracao = { status: 404, body: { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'x' } } };
const configuracoes = {
  status: 200,
  body: {
    tema: { nome: 'Loja X', corPrimaria: '#7C3AED', layout: 'grade', destaque: true },
    entrega: { habilitada: true },
    retirada: { habilitada: false },
    lojasRetirada: [],
    frete: { regra: 'a_combinar' },
    expiracaoLinkDias: 7,
    modoPedido: 'handoff',
    categoriasOcultas: ['2'],
    urlCapturaKentro: null,
    mostrarPrecos: true,
  },
};
const categorias = { status: 200, body: [{ id: '1', nome: 'Pisos' }, { id: '2', nome: 'Tintas' }] };
const salvo = { status: 200, body: configuracoes.body };

async function abrir(extra: OpcoesTela['respostas'] = {}): Promise<Tela> {
  const t = await montarTela('admin/config.html', {
    config,
    respostas: {
      'GET /v1/loja': loja,
      'GET /v1/conectores': { status: 200, body: [] },
      'GET /v1/loja/integracao': semIntegracao,
      'GET /v1/loja/configuracoes': configuracoes,
      'GET /v1/loja/catalogo/categorias': categorias,
      'PATCH /v1/loja/configuracoes': salvo,
      ...extra,
    },
  });
  await t.esperar(5);
  return t;
}

const patches = (t: Tela) => t.chamadas.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body!));
const marcar = (t: Tela, id: string, valor: boolean) => ((t.document.getElementById(id) as HTMLInputElement).checked = valor);
const escolher = (t: Tela, id: string, valor: string) => {
  const el = t.document.getElementById(id) as HTMLSelectElement;
  el.value = valor;
  el.dispatchEvent(new t.document.defaultView!.Event('change', { bubbles: true }));
};

describe('abas de configuração do Admin', () => {
  let t: Tela;
  afterEach(() => t?.fechar());

  it('as abas trocam o conteúdo; Integração continua a primeira', async () => {
    t = await abrir();
    expect(t.visivel('aba-integracao')).toBe(true);
    expect(t.visivel('aba-aparencia')).toBe(false);
    await t.clicar('botao-aba-aparencia');
    expect(t.visivel('aba-aparencia')).toBe(true);
    expect(t.visivel('aba-integracao')).toBe(false);
    expect(t.document.getElementById('botao-aba-aparencia')!.className).toBe('ativa');
  });

  it('Aparência: preenche com o que está gravado, mostra a prévia e salva o tema', async () => {
    t = await abrir();
    await t.clicar('botao-aba-aparencia');
    expect(t.valor('ap-nome')).toBe('Loja X');
    expect(t.valor('ap-cor').toLowerCase()).toBe('#7c3aed');
    t.preencher('ap-nome', 'Shopping dos Pisos');
    t.preencher('ap-cor', '#0055aa');
    t.preencher('ap-cor-topo', '#003366');
    escolher(t, 'ap-layout', 'lista');
    marcar(t, 'ap-destaque', false);
    t.preencher('ap-boas-vindas', 'Escolha com calma!');
    t.document.getElementById('ap-cor')!.dispatchEvent(new t.document.defaultView!.Event('input', { bubbles: true }));
    expect((t.document.getElementById('ap-previa-botao') as HTMLElement).style.background).toBe('rgb(0, 85, 170)');
    await t.clicar('btn-salvar-aparencia');
    expect(patches(t)).toEqual([
      { tema: { nome: 'Shopping dos Pisos', corPrimaria: '#0055aa', corTopo: '#003366', layout: 'lista', destaque: false, boasVindas: 'Escolha com calma!' } },
    ]);
    expect(t.texto('resultado-aparencia')).toBe('Aparência salva.');
  });

  it('Aparência: erro da API aparece (ex.: cor clara demais)', async () => {
    t = await abrir({
      'PATCH /v1/loja/configuracoes': { status: 400, body: { erro: { codigo: 'ENTRADA_INVALIDA', mensagem: 'A cor principal é clara demais.' } } },
    });
    await t.clicar('botao-aba-aparencia');
    await t.clicar('btn-salvar-aparencia');
    expect(t.texto('resultado-aparencia')).toBe('A cor principal é clara demais.');
  });

  it('Aparência: envia o logo em base64 e remove', async () => {
    t = await abrir({
      'PUT /v1/loja/logo': { status: 200, body: { logoUrl: 'https://api.teste/v1/publico/lojas/l1/logo?v=abc' } },
      'DELETE /v1/loja/logo': { status: 200, body: { ok: true } },
    });
    await t.clicar('botao-aba-aparencia');
    const janela = t.document.defaultView!;
    const arquivo = new janela.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });
    const campo = t.document.getElementById('ap-logo') as HTMLInputElement;
    Object.defineProperty(campo, 'files', { value: [arquivo] });
    campo.dispatchEvent(new janela.Event('change', { bubbles: true }));
    await t.esperar(30);
    const put = t.chamadas.find((c) => c.method === 'PUT' && c.url.endsWith('/v1/loja/logo'))!;
    expect(JSON.parse(put.body!)).toEqual({ tipo: 'image/png', base64: 'iVBORw==' });
    expect((t.document.getElementById('ap-logo-atual') as HTMLImageElement).src).toBe('https://api.teste/v1/publico/lojas/l1/logo?v=abc');
    await t.clicar('btn-remover-logo');
    expect(t.chamadas.some((c) => c.method === 'DELETE')).toBe(true);
    expect(t.visivel('ap-logo-atual')).toBe(false);
  });

  it('Aparência: arquivo grande é recusado antes de enviar', async () => {
    t = await abrir();
    await t.clicar('botao-aba-aparencia');
    const janela = t.document.defaultView!;
    const campo = t.document.getElementById('ap-logo') as HTMLInputElement;
    Object.defineProperty(campo, 'files', { value: [new janela.File([new Uint8Array(301 * 1024)], 'g.png', { type: 'image/png' })] });
    campo.dispatchEvent(new janela.Event('change', { bubbles: true }));
    await t.esperar(10);
    expect(t.texto('resultado-aparencia')).toBe('O logo pode ter até 300 KB.');
    expect(t.chamadas.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('Entrega e frete: retirada com lojas e frete grátis acima de um valor', async () => {
    t = await abrir();
    await t.clicar('botao-aba-entrega');
    marcar(t, 'ent-retirada', true);
    await t.clicar('btn-add-loja');
    const campos = t.document.querySelectorAll<HTMLInputElement>('#lojas-retirada [data-loja-campo]');
    const porNome = (n: string) => [...campos].find((c) => c.getAttribute('data-loja-campo') === n)!;
    porNome('nome').value = 'Loja Centro';
    porNome('endereco').value = 'Rua B, 2';
    porNome('horario').value = '8h–18h';
    escolher(t, 'fr-regra', 'gratis_acima_de');
    t.preencher('fr-valor', '15,90');
    t.preencher('fr-minimo', '200');
    t.preencher('fr-prazo', 'Até 3 dias úteis');
    await t.clicar('btn-salvar-entrega');
    expect(patches(t)).toEqual([
      {
        entrega: { habilitada: true },
        retirada: { habilitada: true },
        lojasRetirada: [{ nome: 'Loja Centro', endereco: 'Rua B, 2', horario: '8h–18h', orientacoes: '' }],
        frete: { regra: 'gratis_acima_de', valor: 15.9, minimo: 200, prazo: 'Até 3 dias úteis' },
      },
    ]);
    expect(t.texto('resultado-entrega')).toBe('Entrega e frete salvos.');
  });

  it('Pedidos: preços no catálogo e validade do link', async () => {
    t = await abrir();
    await t.clicar('botao-aba-pedidos');
    expect((t.document.getElementById('pd-precos') as HTMLInputElement).checked).toBe(true);
    expect(t.valor('pd-validade')).toBe('7');
    marcar(t, 'pd-precos', false);
    t.preencher('pd-validade', '3');
    await t.clicar('btn-salvar-pedidos');
    expect(patches(t)).toEqual([{ mostrarPrecos: false, expiracaoLinkDias: 3 }]);
  });

  it('Catálogo: categorias da plataforma com "esconder", já marcadas as ocultas', async () => {
    t = await abrir();
    await t.clicar('botao-aba-catalogo');
    await t.esperar(5);
    const caixa = (id: string) => t.document.querySelector(`[data-ocultar="${id}"]`) as HTMLInputElement;
    expect(caixa('1').checked).toBe(false);
    expect(caixa('2').checked).toBe(true);
    caixa('1').checked = true;
    caixa('2').checked = false;
    await t.clicar('btn-salvar-catalogo');
    expect(patches(t)).toEqual([{ categoriasOcultas: ['1'] }]);
  });

  it('IA: endereço do servidor MCP e token gerado só depois de confirmar', async () => {
    t = await abrir({ 'POST /v1/loja/token-mcp/rotacionar': { status: 200, body: { chave: 'ksm_novo' } } });
    await t.clicar('botao-aba-ia');
    expect(t.visivel('aba-ia')).toBe(true);
    expect(t.texto('ia-url')).toBe('https://api.teste/mcp');
    expect(t.visivel('ia-bloco-token')).toBe(false);
    await t.clicar('btn-gerar-token');
    await t.esperar(5);
    expect(t.texto('ia-token')).toBe('ksm_novo');
    expect(t.visivel('ia-bloco-token')).toBe(true);
    expect(t.chamadas.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['https://api.teste/v1/loja/token-mcp/rotacionar']);
  });

  it('IA: cancelar a confirmação não troca o token', async () => {
    t = await montarTela('admin/config.html', {
      config,
      confirmar: false,
      respostas: {
        'GET /v1/loja': loja,
        'GET /v1/conectores': { status: 200, body: [] },
        'GET /v1/loja/integracao': semIntegracao,
        'GET /v1/loja/configuracoes': configuracoes,
      },
    });
    await t.esperar(5);
    await t.clicar('botao-aba-ia');
    await t.clicar('btn-gerar-token');
    await t.esperar(5);
    expect(t.chamadas.some((c) => c.method === 'POST')).toBe(false);
    expect(t.visivel('ia-bloco-token')).toBe(false);
  });
});
