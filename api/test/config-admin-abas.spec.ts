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

async function abrir(extra: OpcoesTela['respostas'] = {}, opcoes: Partial<OpcoesTela> = {}): Promise<Tela> {
  const t = await montarTela('admin/config.html', {
    ...opcoes,
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
      {
        tema: {
          nome: 'Shopping dos Pisos',
          corPrimaria: '#0055aa',
          corTopo: '#003366',
          layout: 'lista',
          destaque: false,
          boasVindas: 'Escolha com calma!',
          tituloDestaque: '',
          fonte: 'classica',
          cantos: 'arredondados',
          imagemProduto: 'quadrada',
          compreTambem: true,
          bannerSegundos: 5,
        },
      },
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
    expect(t.visivel('bloco-filas')).toBe(false); // SDK sem filas: o bloco não aparece e nada muda
  });

  it('Pedidos: filas da Kentro que usam o catálogo, já marcadas as gravadas', async () => {
    const filas = [{ id: 8, name: 'Loja 08 - WhatsApp' }, { id: 9, name: 'Loja 08 - Balcão' }, { id: 3, name: 'Loja 03' }];
    t = await abrir({ 'GET /v1/loja/configuracoes': { status: 200, body: { ...configuracoes.body, filasAtendimento: [9] } } }, { filas });
    await t.clicar('botao-aba-pedidos');
    await t.esperar(5);
    expect(t.visivel('bloco-filas')).toBe(true);
    const caixa = (id: number) => t.document.querySelector(`[data-fila="${id}"]`) as HTMLInputElement;
    expect([...t.document.querySelectorAll('#lista-filas label')].map((l) => l.textContent!.trim())).toEqual(['Loja 08 - WhatsApp', 'Loja 08 - Balcão', 'Loja 03']);
    expect([caixa(8).checked, caixa(9).checked, caixa(3).checked]).toEqual([false, true, false]);
    caixa(8).checked = true;
    await t.clicar('btn-salvar-pedidos');
    expect(patches(t)).toEqual([{ mostrarPrecos: true, expiracaoLinkDias: 7, filasAtendimento: [8, 9] }]);
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

  it('Aparência: a prévia mostra a letra, os cantos, a foto, o título da faixa e o carrossel de banners', async () => {
    const tema = {
      ...configuracoes.body.tema,
      fonte: 'elegante',
      cantos: 'retos',
      imagemProduto: 'retrato',
      tituloDestaque: 'Moda masculina',
      banners: [
        { id: 'b1', url: 'https://api.teste/b1.png', titulo: 'Verão' },
        { id: 'b2', url: 'https://api.teste/b2.png' },
      ],
    };
    t = await abrir({ 'GET /v1/loja/configuracoes': { status: 200, body: { ...configuracoes.body, tema } } });
    await t.clicar('botao-aba-aparencia');
    const previa = t.document.getElementById('ap-previa')!;
    expect(previa.style.getPropertyValue('--previa-titulo')).toContain('Playfair Display');
    expect(previa.style.getPropertyValue('--pc')).toBe('0');
    expect(previa.style.getPropertyValue('--previa-foto')).toBe('3 / 4');
    expect(t.document.head.querySelector('link[data-fonte="elegante"]')).not.toBeNull();
    expect(t.texto('ap-previa-titulo')).toBe('Moda masculina');
    expect(t.document.querySelectorAll('#ap-previa-banner-trilho .previa-banner-slide')).toHaveLength(2);
    expect(t.document.querySelector('#ap-previa-banner-trilho span')!.textContent).toBe('Verão');
    // Os pontos trocam o banner da prévia; mudar a letra atualiza na hora.
    (t.document.querySelectorAll('#ap-previa-banner-pontos button')[1] as HTMLButtonElement).click();
    expect(t.document.getElementById('ap-previa-banner-trilho')!.style.transform).toBe('translateX(-100%)');
    escolher(t, 'ap-fonte', 'forte');
    expect(previa.style.getPropertyValue('--previa-titulo')).toContain('Oswald');
  });

  describe('WhatsApp oficial', () => {
    const TEMPLATES = [
      { cartoes: 2, nome: 'kshop_carrossel_2', status: 'APPROVED' },
      { cartoes: 3, nome: 'kshop_carrossel_3', status: 'NAO_CRIADO' },
    ];
    const CONECTADO = { configurado: true, wabaId: '111111', telefoneId: '222222' };
    const chamadasDe = (metodo: string, trecho: string) => t.chamadas.filter((c) => c.method === metodo && c.url.endsWith(trecho));

    it('conecta conferindo com a Meta, limpa o token da tela e mostra os templates', async () => {
      t = await abrir({
        'GET /v1/loja/whatsapp-meta': { status: 200, body: { configurado: false } },
        'PUT /v1/loja/whatsapp-meta': { status: 200, body: { ...CONECTADO, conta: 'Rede Biomax', numero: '+55 38 99999-0000' } },
        'GET /v1/loja/whatsapp-meta/templates': { status: 200, body: { templates: TEMPLATES } },
      });
      await t.clicar('botao-aba-whatsapp');
      await t.esperar(5);
      expect(t.visivel('aba-whatsapp')).toBe(true);
      expect(t.visivel('wa-bloco-templates')).toBe(false);
      t.preencher('wa-waba', '111111');
      t.preencher('wa-telefone', '222222');
      t.preencher('wa-token', 'EAAG-secreto');
      await t.clicar('btn-salvar-whatsapp');
      await t.esperar(5);
      expect(JSON.parse(chamadasDe('PUT', '/v1/loja/whatsapp-meta')[0].body!)).toEqual({ wabaId: '111111', telefoneId: '222222', token: 'EAAG-secreto' });
      expect((t.document.getElementById('wa-token') as HTMLInputElement).value).toBe('');
      expect(t.texto('wa-conectado')).toBe('Conectado: Rede Biomax · +55 38 99999-0000');
      expect(t.texto('wa-templates')).toContain('Aprovado');
      expect(t.texto('wa-templates')).toContain('Não criado');
    });

    it('com a conta ligada, salvar sem token não manda o campo; a recusa mostra o motivo', async () => {
      t = await abrir({
        'GET /v1/loja/whatsapp-meta': { status: 200, body: CONECTADO },
        'PUT /v1/loja/whatsapp-meta': { status: 200, body: { ok: false, mensagem: 'O token da Meta é inválido ou expirou.' } },
        'GET /v1/loja/whatsapp-meta/templates': { status: 200, body: { templates: TEMPLATES } },
      });
      await t.clicar('botao-aba-whatsapp');
      await t.esperar(5);
      expect((t.document.getElementById('wa-waba') as HTMLInputElement).value).toBe('111111');
      await t.clicar('btn-salvar-whatsapp');
      await t.esperar(5);
      expect(JSON.parse(chamadasDe('PUT', '/v1/loja/whatsapp-meta')[0].body!)).toEqual({ wabaId: '111111', telefoneId: '222222' });
      expect(t.texto('resultado-whatsapp')).toBe('O token da Meta é inválido ou expirou.');
    });

    it('cria os templates e trava o botão quando não falta nenhum', async () => {
      t = await abrir({
        'GET /v1/loja/whatsapp-meta': { status: 200, body: CONECTADO },
        'GET /v1/loja/whatsapp-meta/templates': { status: 200, body: { templates: TEMPLATES } },
        'POST /v1/loja/whatsapp-meta/templates': { status: 200, body: { templates: [TEMPLATES[0], { ...TEMPLATES[1], status: 'PENDING' }] } },
      });
      await t.clicar('botao-aba-whatsapp');
      await t.esperar(5);
      const criar = t.document.getElementById('btn-criar-templates') as HTMLButtonElement;
      expect(criar.disabled).toBe(false);
      await t.clicar('btn-criar-templates');
      await t.esperar(5);
      expect(t.texto('wa-templates')).toContain('Em análise');
      expect(t.texto('resultado-templates')).toBe('Templates enviados para aprovação.');
      expect(criar.disabled).toBe(true);
    });

    it('recusa ao criar mostra o motivo e deixa tentar de novo', async () => {
      t = await abrir({
        'GET /v1/loja/whatsapp-meta': { status: 200, body: CONECTADO },
        'GET /v1/loja/whatsapp-meta/templates': { status: 200, body: { templates: TEMPLATES } },
        'POST /v1/loja/whatsapp-meta/templates': { status: 200, body: { ok: false, mensagem: 'Sem foto de exemplo.' } },
      });
      await t.clicar('botao-aba-whatsapp');
      await t.esperar(5);
      await t.clicar('btn-criar-templates');
      await t.esperar(5);
      expect(t.texto('resultado-templates')).toBe('Sem foto de exemplo.');
      expect((t.document.getElementById('btn-criar-templates') as HTMLButtonElement).disabled).toBe(false);
    });

    it('desconectar esconde os templates', async () => {
      t = await abrir({
        'GET /v1/loja/whatsapp-meta': { status: 200, body: CONECTADO },
        'GET /v1/loja/whatsapp-meta/templates': { status: 200, body: { templates: TEMPLATES } },
        'DELETE /v1/loja/whatsapp-meta': { status: 200, body: { ok: true } },
      });
      await t.clicar('botao-aba-whatsapp');
      await t.esperar(5);
      await t.clicar('btn-remover-whatsapp');
      await t.esperar(5);
      expect(t.visivel('wa-bloco-templates')).toBe(false);
      expect(t.texto('resultado-whatsapp')).toBe('WhatsApp oficial desconectado.');
    });
  });

  describe('Relatórios', () => {
    const dia = (d: string, valor = 0, pedidos = 0, links = 0) => ({ dia: d, valor, pedidos, links });
    const RELATORIO = {
      periodo: { de: '2026-11-10', ate: '2026-11-11', dias: 2 },
      resumo: { links: 4, convertidos: 2, pedidos: 2, valor: 389.7, abertos: 3, ticketMedio: 194.85, cancelados: 1, valorCancelado: 50, entrega: 2, retirada: 0, naLoja: 1 },
      porOrigem: [
        { origem: 'ia', links: 1, convertidos: 1, pedidos: 1, valor: 129.9 },
        { origem: 'ura', links: 1, convertidos: 0, pedidos: 0, valor: 0 },
        { origem: 'atendente', links: 2, convertidos: 1, pedidos: 1, valor: 259.8 },
      ],
      porAtendente: [{ nome: 'Carlos', links: 2, convertidos: 1, pedidos: 1, valor: 259.8, fechadosNoPainel: 1, valorNoPainel: 259.8 }],
      quemFinalizou: { cliente: { pedidos: 1, valor: 129.9 }, atendente: { pedidos: 1, valor: 259.8 } },
      porDia: [dia('2026-11-10'), dia('2026-11-11', 389.7, 2, 4)],
      produtos: [{ nome: 'Dipirona 500mg', quantidade: 3, valor: 389.7, pedidos: 2 }],
      pedidos: [
        { sessaoId: 's1', chatId: '41', em: '2026-11-11T15:30:00.000Z', cliente: 'Ana\tSouza', telefone: '5538988887777', tipo: 'entrega', total: 129.9, origem: 'ia', geradoPor: '', finalizadaPor: 'cliente', finalizadaPorNome: '', pedidoNumero: '', situacao: '', cancelado: false },
        { sessaoId: 's2', chatId: '42', em: '2026-11-11T14:00:00.000Z', cliente: 'Bia', telefone: '', tipo: 'entrega', total: 259.8, origem: 'atendente', geradoPor: 'Carlos', finalizadaPor: 'atendente', finalizadaPorNome: 'Carlos', pedidoNumero: '77', situacao: 'Em separação', cancelado: false },
        { sessaoId: 's3', chatId: '43', em: '2026-11-10T14:00:00.000Z', cliente: 'Caio', telefone: '', tipo: 'retirada', total: 50, origem: 'ura', geradoPor: '', finalizadaPor: 'cliente', finalizadaPorNome: '', pedidoNumero: '78', situacao: 'Cancelado', cancelado: true },
      ],
      listaCortada: false,
    };
    const consultas = () => t.chamadas.filter((c) => c.method === 'GET' && c.url.includes('/v1/loja/relatorios')).map((c) => new URL(c.url).searchParams);
    const celulas = (id: string) =>
      [...t.document.querySelectorAll(`#${id} tbody tr`)].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    const atalho = (qual: string) => t.document.querySelector<HTMLButtonElement>(`[data-rel-atalho="${qual}"]`)!;

    it('abre com os últimos 30 dias e mostra números, gráfico, origens, atendentes, produtos e pedidos', async () => {
      t = await abrir({ 'GET /v1/loja/relatorios': { status: 200, body: RELATORIO } });
      await t.clicar('botao-aba-relatorios');
      await t.esperar(5);
      expect(t.visivel('aba-relatorios')).toBe(true);
      const [q] = consultas();
      const de = Date.parse(`${q.get('de')}T00:00:00Z`);
      const ate = Date.parse(`${q.get('ate')}T00:00:00Z`);
      expect((ate - de) / 86_400_000).toBe(29);
      expect(atalho('30').className).toBe('ativa');

      expect(t.visivel('rel-conteudo')).toBe(true);
      const numeros = t.texto('rel-numeros');
      expect(numeros).toMatch(/389,70/);
      expect(numeros).toContain('Conversão50%');
      expect(numeros).toContain('Abertos pelo cliente: 75%');
      expect(numeros).toMatch(/Cancelados.*1.*50,00 fora da conta/);

      // Valor e cancelados explicam como são calculados: o "i" abre e fecha a explicação.
      const infos = [...t.document.querySelectorAll<HTMLButtonElement>('#rel-numeros .rel-info')];
      expect(infos.map((b) => b.getAttribute('aria-label'))).toEqual(['Como é calculado: Valor em pedidos', 'Como é calculado: Cancelados']);
      const explicacao = (b: HTMLButtonElement) => t.document.getElementById(b.getAttribute('aria-controls')!)!;
      expect(explicacao(infos[1]).hidden).toBe(true);
      infos[1].click();
      expect(explicacao(infos[1]).hidden).toBe(false);
      expect(infos[1].getAttribute('aria-expanded')).toBe('true');
      expect(explicacao(infos[1]).textContent).toContain('Atualizar situação');
      expect(explicacao(infos[0]).textContent).toContain('não confirma pagamento nem entrega');
      infos[1].click();
      expect(explicacao(infos[1]).hidden).toBe(true);

      const barras = t.document.querySelectorAll('#rel-grafico .rel-barra');
      expect(barras).toHaveLength(2);
      expect(barras[1].getAttribute('aria-label')).toMatch(/^11\/11: R\$\s389,70, 2 pedido\(s\), 4 link\(s\)$/);
      expect((barras[0].querySelector('i') as HTMLElement).style.height).toBe('0px');
      barras[1].dispatchEvent(new t.document.defaultView!.Event('mouseenter'));
      expect(t.document.querySelector('#rel-grafico .rel-dica')!.textContent).toContain('Links enviados: 4');

      expect(celulas('rel-origem').map((l) => [l[0], l[3]])).toEqual([
        ['Assistente de IA', '100%'],
        ['URA da Kentro', '0%'],
        ['Atendentes', '50%'],
      ]);
      expect(celulas('rel-atendentes')[0][0]).toBe('Carlos');
      expect(celulas('rel-atendentes')[0][5]).toMatch(/^1 · R\$\s259,80$/);
      expect(celulas('rel-produtos')[0][0]).toBe('Dipirona 500mg');
      expect(celulas('rel-pedidos').map((l) => [l[2], l[3], l[6]])).toEqual([
        ['Assistente de IA', 'Cliente (link)', '—'],
        ['Carlos', 'Carlos (painel)', 'nº 77 — Em separação'],
        ['URA da Kentro', 'Cliente (link)', 'nº 78 — Cancelado'],
      ]);
      expect(t.document.querySelectorAll('#rel-pedidos tr.cancelado')).toHaveLength(1);
    });

    it('atalhos e datas escolhidas refazem a consulta; copiar leva os pedidos separados por tabulação', async () => {
      t = await abrir({ 'GET /v1/loja/relatorios': { status: 200, body: RELATORIO } });
      await t.clicar('botao-aba-relatorios');
      await t.esperar(5);
      atalho('hoje').click();
      await t.esperar(5);
      expect(consultas()[1].get('de')).toBe(consultas()[1].get('ate'));
      atalho('mes').click();
      await t.esperar(5);
      expect(consultas()[2].get('de')).toMatch(/-01$/);

      t.preencher('rel-de', '2026-10-01');
      t.preencher('rel-ate', '2026-10-31');
      await t.clicar('btn-rel-ver');
      await t.esperar(5);
      expect(consultas()[3].get('de')).toBe('2026-10-01');
      expect(consultas()[3].get('ate')).toBe('2026-10-31');
      expect(t.document.querySelector('.rel-atalhos .ativa')).toBeNull();

      await t.clicar('btn-rel-copiar');
      await t.esperar(5);
      const linhas = t.copiados[0].split('\n');
      expect(linhas).toHaveLength(4);
      expect(linhas[0].split('\t')[0]).toBe('Data');
      expect(linhas[1].split('\t')).toHaveLength(10);
      expect(linhas[1].split('\t')[1]).toBe('Ana Souza'); // tabulação dentro do campo não quebra a planilha
      expect(linhas[3].split('\t')[8]).toBe('Cancelado');
    });

    it('erro da API aparece no lugar do relatório', async () => {
      t = await abrir(
        { 'GET /v1/loja/relatorios': { status: 400, body: { erro: { codigo: 'ENTRADA_INVALIDA', mensagem: 'O período pode ter até 366 dias.' } } } },
        { proxy: 'resolve' },
      );
      await t.clicar('botao-aba-relatorios');
      await t.esperar(5);
      expect(t.texto('resultado-relatorio')).toContain('366 dias');
      expect(t.visivel('rel-conteudo')).toBe(false);
    });
  });

  describe('URA: chave de automação', () => {
    const chamadasDe = (metodo: string, trecho: string) => t.chamadas.filter((c) => c.method === metodo && c.url.endsWith(trecho));

    it('mostra o endereço e o corpo; a primeira chave sai sem confirmação e aparece uma vez', async () => {
      t = await abrir({
        'GET /v1/loja/chave-automacao': { status: 200, body: { ativa: false } },
        'POST /v1/loja/chave-automacao/rotacionar': { status: 200, body: { chave: 'ksu_nova' } },
      }, { confirmar: false });
      await t.clicar('botao-aba-automacao');
      await t.esperar(5);
      expect(t.visivel('aba-automacao')).toBe(true);
      expect(t.texto('auto-url')).toBe('https://api.teste/v1/automacao/link');
      expect(t.texto('auto-corpo')).toContain('"chatId": "{{chat_id}}"');
      expect(t.texto('auto-situacao')).toContain('Nenhuma chave');
      expect(t.visivel('btn-desativar-automacao')).toBe(false);
      expect(t.visivel('auto-bloco-chave')).toBe(false);
      await t.clicar('btn-gerar-chave-automacao');
      await t.esperar(5);
      expect(t.texto('auto-chave')).toBe('ksu_nova');
      expect(t.visivel('auto-bloco-chave')).toBe(true);
      expect(t.visivel('btn-desativar-automacao')).toBe(true);
      expect(t.texto('auto-rotulo-gerar')).toBe('Gerar nova chave');
    });

    it('com a chave ativa, gerar outra pede confirmação; cancelar não troca', async () => {
      t = await abrir({ 'GET /v1/loja/chave-automacao': { status: 200, body: { ativa: true } } }, { confirmar: false });
      await t.clicar('botao-aba-automacao');
      await t.esperar(5);
      expect(t.texto('auto-situacao')).toContain('ativa');
      await t.clicar('btn-gerar-chave-automacao');
      await t.esperar(5);
      expect(chamadasDe('POST', '/v1/loja/chave-automacao/rotacionar')).toHaveLength(0);
    });

    it('desativa a chave', async () => {
      t = await abrir({
        'GET /v1/loja/chave-automacao': { status: 200, body: { ativa: true } },
        'DELETE /v1/loja/chave-automacao': { status: 200, body: { ativa: false } },
      });
      await t.clicar('botao-aba-automacao');
      await t.esperar(5);
      await t.clicar('btn-desativar-automacao');
      await t.esperar(5);
      expect(chamadasDe('DELETE', '/v1/loja/chave-automacao')).toHaveLength(1);
      expect(t.texto('resultado-automacao')).toBe('Chave desativada.');
      expect(t.visivel('btn-desativar-automacao')).toBe(false);
    });
  });

  describe('Aparência: vitrine da página inicial', () => {
    const produto = (id: string, nome: string) => ({ id, nome, sku: `S${id}`, imagens: [] });
    const comVitrine = (ids: string[], titulo?: string) => ({
      status: 200,
      body: { ...configuracoes.body, tema: { ...configuracoes.body.tema, vitrineProdutos: ids, ...(titulo ? { vitrineTitulo: titulo } : {}) } },
    });
    const clicarEm = (seletor: string, indice = 0) => (t.document.querySelectorAll(seletor)[indice] as HTMLButtonElement).click();
    const escolhidos = () => [...t.document.querySelectorAll('#ap-vitrine li')].map((li) => li.getAttribute('data-vitrine'));

    it('carrega os nomes, busca, adiciona, ordena, remove e salva a lista na nova ordem', async () => {
      t = await abrir({
        'GET /v1/loja/configuracoes': comVitrine(['A', 'B', 'sumiu'], 'Campeões'),
        'GET /v1/loja/catalogo/produtos-por-id': { status: 200, body: [produto('A', 'Ozempic'), produto('B', 'Dipirona')] },
        'GET /v1/loja/catalogo/produtos': { status: 200, body: { itens: [produto('A', 'Ozempic'), produto('C', 'Mounjaro')] } },
      });
      await t.clicar('botao-aba-aparencia');
      await t.esperar(5);
      expect((t.document.getElementById('ap-vitrine-titulo') as HTMLInputElement).value).toBe('Campeões');
      expect(escolhidos()).toEqual(['A', 'B', 'sumiu']);
      expect(t.texto('ap-vitrine')).toContain('Ozempic');
      expect(t.texto('ap-vitrine')).toContain('Não encontrado no catálogo');
      expect(t.texto('ap-vitrine-contagem')).toBe('3 de 12 produtos escolhidos');

      t.preencher('ap-vitrine-busca', 'o');
      await t.clicar('btn-vitrine-buscar');
      await t.esperar(5);
      // O que já está escolhido não entra duas vezes.
      expect((t.document.querySelector('[data-vitrine-resultado="A"] button') as HTMLButtonElement).disabled).toBe(true);
      clicarEm('[data-vitrine-resultado="C"] button');
      expect(escolhidos()).toEqual(['A', 'B', 'sumiu', 'C']);

      clicarEm('[data-vitrine="sumiu"] button', 2); // Remover
      clicarEm('[data-vitrine="B"] button', 0); // Subir
      expect(escolhidos()).toEqual(['B', 'A', 'C']);

      await t.clicar('btn-salvar-vitrine');
      expect(patches(t)).toEqual([{ tema: { vitrineTitulo: 'Campeões', vitrineProdutos: ['B', 'A', 'C'] } }]);
      expect(t.texto('resultado-vitrine')).toBe('Vitrine salva.');
    });

    it('com 12 escolhidos não deixa adicionar mais', async () => {
      const doze = Array.from({ length: 12 }, (_, i) => `p${i}`);
      t = await abrir({
        'GET /v1/loja/configuracoes': comVitrine(doze),
        'GET /v1/loja/catalogo/produtos-por-id': { status: 200, body: doze.map((id) => produto(id, id)) },
        'GET /v1/loja/catalogo/produtos': { status: 200, body: { itens: [produto('novo', 'Novo')] } },
      });
      await t.clicar('botao-aba-aparencia');
      t.preencher('ap-vitrine-busca', 'novo');
      await t.clicar('btn-vitrine-buscar');
      await t.esperar(5);
      expect((t.document.querySelector('[data-vitrine-resultado="novo"] button') as HTMLButtonElement).disabled).toBe(true);
    });

    it('se os nomes não carregarem, salvar não perde a seleção', async () => {
      t = await abrir({
        'GET /v1/loja/configuracoes': comVitrine(['A', 'B']),
        'GET /v1/loja/catalogo/produtos-por-id': { status: 500, body: { erro: { codigo: 'ERRO', mensagem: 'x' } } },
      });
      await t.clicar('botao-aba-aparencia');
      await t.esperar(5);
      expect(t.texto('ap-vitrine')).toContain('Produto A');
      await t.clicar('btn-salvar-vitrine');
      expect(patches(t)).toEqual([{ tema: { vitrineTitulo: '', vitrineProdutos: ['A', 'B'] } }]);
    });
  });

  it('Aparência: banners gravados aparecem na lista; salvar a ação e remover vão direto para a API', async () => {
    const banner = { id: 'b1', url: 'https://api.teste/b1.png', titulo: 'Verão' };
    t = await abrir({
      'GET /v1/loja/configuracoes': { status: 200, body: { ...configuracoes.body, tema: { ...configuracoes.body.tema, banners: [banner], bannerSegundos: 7 } } },
      'PATCH /v1/loja/banners/b1': { status: 200, body: [{ ...banner, categoriaId: '1' }] },
      'DELETE /v1/loja/banners/b1': { status: 200, body: [] },
    });
    await t.clicar('botao-aba-aparencia');
    await t.esperar(5);
    expect(t.valor('ap-banner-segundos')).toBe('7');
    const item = t.document.querySelector('[data-banner="b1"]')!;
    expect((item.querySelector('[data-campo="titulo"]') as HTMLInputElement).value).toBe('Verão');
    escolher(t, 'ap-fonte', 'moderna'); // não interfere nos banners
    const acao = item.querySelector('[data-campo="acao"]') as HTMLSelectElement;
    acao.value = 'categoria';
    acao.dispatchEvent(new t.document.defaultView!.Event('change', { bubbles: true }));
    (item.querySelector('[data-campo="categoria"]') as HTMLSelectElement).value = '1';
    (item.querySelector('[data-salvar-banner="b1"]') as HTMLButtonElement).click();
    await t.esperar(5);
    const patch = t.chamadas.find((c) => c.method === 'PATCH' && c.url.endsWith('/v1/loja/banners/b1'))!;
    expect(JSON.parse(patch.body!)).toEqual({ titulo: 'Verão', categoriaId: '1', busca: '' });
    (t.document.querySelector('[data-remover-banner="b1"]') as HTMLButtonElement).click();
    await t.esperar(5);
    expect(t.chamadas.some((c) => c.method === 'DELETE' && c.url.endsWith('/v1/loja/banners/b1'))).toBe(true);
    expect(t.visivel('ap-banners-vazio')).toBe(true);
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

  it('IA: salva e testa o endereço da captura do aviso de pedido finalizado', async () => {
    t = await abrir({ 'POST /v1/loja/ia/testar-evento': { status: 200, body: { ok: true, status: 200 } } });
    await t.clicar('botao-aba-ia');
    expect(t.valor('ia-captura')).toBe('');
    t.preencher('ia-captura', ' https://x.atenderbem.com/webhookcapture/capture/abc12345 ');
    await t.clicar('btn-salvar-captura');
    expect(patches(t)).toEqual([{ urlCapturaKentro: 'https://x.atenderbem.com/webhookcapture/capture/abc12345' }]);
    await t.clicar('btn-testar-captura');
    await t.esperar(5);
    expect(t.texto('resultado-captura')).toBe('A Kentro recebeu o aviso de teste.');
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
