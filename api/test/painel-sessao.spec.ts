import { montarTela, OpcoesTela, Tela } from './omni-falso';

const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_abc' };
const lojaOk = { status: 200, body: { id: 'l1', nome: 'Pisos & Cia', status: 'ativa', plano: 'gratis', papel: 'atendimento' } };
const agora = new Date().toISOString();
const futuro = new Date(Date.now() + 86_400_000).toISOString();

function sessao(extra: Record<string, unknown> = {}) {
  return {
    id: 's1',
    status: 'navegando',
    url: 'https://shop.teste/c/tok123',
    cliente: { nome: 'Ana Souza', telefone: '5538988887777' },
    itens: [
      {
        produtoId: 'A1',
        variacaoId: null,
        sku: 'A1',
        nome: 'Porcelanato Bege',
        variacaoNome: null,
        imagem: null,
        unidade: 'CX',
        precoUnitario: 129.9,
        quantidade: 2,
        subtotal: 259.8,
        m2: 2.88,
      },
    ],
    totais: { itens: 2, subtotal: 259.8, frete: null, desconto: 0, total: 259.8 },
    checkout: null,
    eventos: [
      { em: agora, texto: 'Adicionou 2 caixas de Porcelanato Bege', autor: 'cliente' },
      { em: agora, texto: 'Cliente abriu o catálogo', autor: 'cliente' },
    ],
    resumo: 'Resumo do atendimento\n\nCliente: Ana Souza',
    abertaEm: agora,
    finalizadaEm: null,
    expiraEm: futuro,
    ...extra,
  };
}

const finalizada = () =>
  sessao({
    status: 'finalizado',
    finalizadaEm: agora,
    checkout: {
      tipo: 'entrega',
      entrega: { nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '39400-000', estado: 'MG', cidade: 'Montes Claros', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: '', referencia: '' },
      observacoes: 'Entregar sábado',
    },
  });

const rota = (chatId: string | number) => `GET /v1/sessoes/chat/${chatId}`;
const semSessao = { status: 404, body: { erro: { codigo: 'SEM_SESSAO', mensagem: 'Nenhum link.' } } };

const PRODUTOS = {
  status: 200,
  body: {
    itens: [
      { id: 'A1', sku: 'A1', nome: 'Porcelanato Bege', preco: 129.9, unidade: 'CX', disponivel: true, variacoes: [], imagens: [], categoriaIds: ['1'] },
      {
        id: 'T1',
        sku: 'T1',
        nome: 'Tinta',
        preco: 80,
        unidade: 'UN',
        disponivel: true,
        variacoes: [
          { id: 'v1', sku: 'T1-B', nome: 'Branco', preco: 80, disponivel: true },
          { id: 'v2', sku: 'T1-P', nome: 'Preto', preco: 90, disponivel: false },
        ],
        imagens: [],
        categoriaIds: ['2'],
      },
    ],
    pagina: 1,
    porPagina: 24,
    temMais: false,
  },
};
const CATEGORIAS = { status: 200, body: [{ id: '1', nome: 'Pisos' }, { id: '2', nome: 'Tintas' }] };
const HISTORICO = {
  status: 200,
  body: {
    enderecos: [],
    pedidos: [
      {
        data: '2026-09-01T12:00:00.000Z',
        total: 339.8,
        itens: [
          { produtoId: 'A1', variacaoId: null, sku: 'A1', nome: 'Porcelanato Bege', variacaoNome: null, quantidade: 2 },
          { produtoId: 'T1', variacaoId: 'v1', sku: 'T1-B', nome: 'Tinta', variacaoNome: 'Branco', quantidade: 1 },
        ],
      },
    ],
  },
};

describe('painel do atendimento — montar link e pedidos anteriores', () => {
  let tela: Tela;
  afterEach(() => tela?.fechar());

  async function montar(extra: Partial<OpcoesTela> = {}) {
    tela = await montarTela('atendimento/painel.html', {
      config,
      intervaloMs: 5000,
      chat: { id: 57, contactId: 9 },
      contatos: { '9': { name: 'Ana Souza', phone: '5538988887777' } },
      ...extra,
      respostas: {
        'GET /v1/loja': lojaOk,
        [rota(57)]: semSessao,
        'GET /v1/loja/catalogo/produtos': PRODUTOS,
        'GET /v1/loja/catalogo/categorias': CATEGORIAS,
        'GET /v1/sessoes/historico': HISTORICO,
        'POST /v1/sessoes': { status: 201, body: { ...sessao({ status: 'link_enviado' }), avisos: ['Tinta (Preto) não está mais disponível.'] } },
        ...extra.respostas,
      },
    });
    await tela.esperar(5);
    return tela;
  }
  const corpoDoPost = () => JSON.parse(tela.chamadas.find((c) => c.method === 'POST')!.body!);
  const clicarEm = async (seletor: string) => {
    (tela.document.querySelector(seletor) as HTMLElement).dispatchEvent(new tela.document.defaultView!.MouseEvent('click', { bubbles: true }));
    await tela.esperar(5);
  };

  it('mostra os pedidos anteriores do contato e "Usar estes itens" monta o carrinho', async () => {
    await montar();
    const historico = tela.chamadas.find((c) => c.url.includes('/v1/sessoes/historico'))!;
    expect(historico.url).toBe('https://api.teste/v1/sessoes/historico?telefone=5538988887777');
    expect(tela.texto('historico-lista')).toContain('2× Porcelanato Bege');
    await clicarEm('[data-usar-pedido="0"]');
    expect(tela.texto('montar-itens')).toContain('2× Porcelanato Bege');
    expect(tela.texto('montar-itens')).toContain('1× Tinta (Branco)');
    await tela.clicar('btn-gerar-montado');
    expect(corpoDoPost()).toMatchObject({
      chatId: '57',
      itens: [
        { produtoId: 'A1', quantidade: 2 },
        { produtoId: 'T1', variacaoId: 'v1', quantidade: 1 },
      ],
    });
    expect(tela.texto('montar-aviso')).toBe('Tinta (Preto) não está mais disponível.');
    expect(tela.visivel('com-sessao')).toBe(true);
    expect(tela.copiados).toEqual(['https://shop.teste/c/tok123']);
  });

  it('busca produtos, escolhe variação e quantidade e gera um link com os escolhidos em destaque (sem preço, catálogo liberado)', async () => {
    await montar();
    tela.preencher('montar-busca', 'tinta');
    await tela.clicar('btn-buscar');
    expect(tela.chamadas.some((c) => c.url === 'https://api.teste/v1/loja/catalogo/produtos?busca=tinta')).toBe(true);
    expect(tela.texto('montar-resultados')).toContain('Porcelanato Bege');
    // Variação esgotada não aparece para escolher.
    const opcoes = [...tela.document.querySelectorAll('[data-variacao="T1"] option')].map((o) => o.textContent);
    expect(opcoes).toEqual(['Branco']);
    (tela.document.querySelector('[data-quantidade="A1"]') as HTMLInputElement).value = '3';
    await clicarEm('[data-adicionar="A1"]');
    await clicarEm('[data-adicionar="T1"]');
    expect(tela.texto('montar-itens')).toContain('3× Porcelanato Bege');
    (tela.document.getElementById('op-carrinho') as HTMLInputElement).checked = false;
    (tela.document.getElementById('op-ver-escolhidos') as HTMLInputElement).checked = true;
    (tela.document.getElementById('op-sem-preco') as HTMLInputElement).checked = true;
    await tela.clicar('btn-gerar-montado');
    const corpo = corpoDoPost();
    expect(corpo).toMatchObject({ filtro: { produtoIds: ['A1', 'T1'] }, mostrarPrecos: false });
    expect(corpo.itens).toBeUndefined();
  });

  it('"nos produtos escolhidos" abre o link na seleção; sem escolher nada, pede os produtos', async () => {
    await montar();
    (tela.document.getElementById('op-ver-escolhidos') as HTMLInputElement).checked = true;
    await tela.clicar('btn-gerar-montado');
    expect(tela.texto('montar-aviso')).toBe('Escolha os produtos que o cliente vai ver.');
    await clicarEm('[data-usar-pedido="0"]');
    await tela.clicar('btn-gerar-montado');
    const corpo = corpoDoPost();
    expect(corpo.filtro).toEqual({ produtoIds: ['A1', 'T1'] });
    expect(corpo.restrito).toBeUndefined();
  });

  it('link limitado a uma categoria: escolher a categoria marca a opção', async () => {
    await montar();
    await tela.esperar(5);
    const select = tela.document.getElementById('montar-categoria') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new tela.document.defaultView!.Event('change', { bubbles: true }));
    expect((tela.document.getElementById('op-ver-categoria') as HTMLInputElement).checked).toBe(true);
    await tela.clicar('btn-gerar-montado');
    expect(corpoDoPost()).toMatchObject({ filtro: { categoriaId: '2' } });
    expect(corpoDoPost().restrito).toBeUndefined();
  });

  it('sem nada escolhido, avisa em vez de gerar', async () => {
    await montar();
    await tela.clicar('btn-gerar-montado');
    expect(tela.chamadas.some((c) => c.method === 'POST')).toBe(false);
    expect(tela.texto('montar-aviso')).toBe('Adicione produtos ou escolha uma opção do link.');
  });

  it('sem link aberto, só existe o "Gerar link" (não há carrinho para adicionar)', async () => {
    await montar();
    expect(tela.visivel('acao-carrinho')).toBe(false);
    expect((tela.document.getElementById('link-novo') as HTMLDetailsElement).open).toBe(true);
    expect(tela.texto('btn-gerar-montado')).toBe('Gerar link');
  });

  it('com link aberto: "Adicionar ao carrinho do cliente" soma ao carrinho dele, no mesmo link', async () => {
    const aberta = sessao({ status: 'navegando' });
    await montar({
      respostas: {
        [rota(57)]: { status: 200, body: aberta },
        [`POST /v1/sessoes/${aberta.id}/itens`]: { status: 200, body: { sessao: aberta, avisos: [] } },
      },
    });
    expect(tela.visivel('acao-carrinho')).toBe(true);
    expect(tela.visivel('aviso-link-novo')).toBe(true);
    expect(tela.texto('btn-gerar-montado')).toBe('Gerar link novo');
    await clicarEm('[data-usar-pedido="0"]');
    await tela.clicar('btn-adicionar-carrinho');
    const post = tela.chamadas.find((c) => c.method === 'POST' && c.url.endsWith(`/v1/sessoes/${aberta.id}/itens`))!;
    expect(JSON.parse(post.body!)).toEqual({
      itens: [
        { produtoId: 'A1', quantidade: 2 },
        { produtoId: 'T1', variacaoId: 'v1', quantidade: 1 },
      ],
    });
    expect(tela.chamadas.some((c) => c.method === 'POST' && c.url.endsWith('/v1/sessoes'))).toBe(false); // nada de link novo
    expect(tela.texto('montar-aviso')).toBe('Adicionado ao carrinho do cliente. Ele vê ao voltar para o catálogo.');
    expect(tela.texto('montar-itens')).toBe('');
  });
});

describe('painel do atendimento — carrinho nativo da Kentro (loja com o catálogo da Kentro)', () => {
  let tela: Tela;
  afterEach(() => tela?.fechar());
  const lojaKentro = { status: 200, body: { ...lojaOk.body, plataforma: 'kentro' } };
  const finalizadaKentro = () => {
    const s = finalizada();
    return {
      ...s,
      itens: [
        { ...s.itens[0], produtoId: '12', sku: 'PRC-1', nome: 'Porcelanato Bege', quantidade: 2 },
        { ...s.itens[0], produtoId: '15', sku: 'ARG', nome: 'Argamassa', quantidade: 3 },
      ],
    };
  };
  async function montar(extra: Partial<OpcoesTela>) {
    tela = await montarTela('atendimento/painel.html', { config, intervaloMs: 30, chat: { id: 55 }, ...extra, respostas: { 'GET /v1/loja': lojaKentro, ...extra.respostas } });
    await tela.esperar(5);
  }

  it('quando o cliente finaliza, lança os itens no carrinho do atendimento (sem duplicar o que já está lá)', async () => {
    await montar({ carrinho: { linhas: [{ productId: 12, qty: 1 }] }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    tela.respostas[rota(55)] = { status: 200, body: finalizadaKentro() };
    await tela.esperar(80);
    expect(tela.operacoesCarrinho).toEqual([
      ['set', 12, 2],
      ['add', 15, 3],
    ]);
    expect(tela.texto('carrinho-kentro')).toBe('Itens lançados no carrinho da Kentro.');
  });

  it('abrir um pedido já finalizado não lança sozinho; o botão lança e avisa o que foi recusado', async () => {
    await montar({ carrinho: { recusar: { 15: 'product_not_in_queue' } }, respostas: { [rota(55)]: { status: 200, body: finalizadaKentro() } } });
    expect(tela.operacoesCarrinho).toEqual([]);
    expect(tela.visivel('btn-carrinho-kentro')).toBe(true);
    await tela.clicar('btn-carrinho-kentro');
    expect(tela.operacoesCarrinho).toEqual([
      ['add', 12, 2],
      ['add', 15, 3],
    ]);
    expect(tela.texto('carrinho-kentro')).toBe('Não entrou no carrinho da Kentro: Argamassa (fora dos grupos de produtos desta fila).');
  });

  it('fila sem carrinho sincronizado: explica em vez de lançar', async () => {
    await montar({ carrinho: { disponivel: false }, respostas: { [rota(55)]: { status: 200, body: finalizadaKentro() } } });
    await tela.clicar('btn-carrinho-kentro');
    expect(tela.operacoesCarrinho).toEqual([]);
    expect(tela.texto('carrinho-kentro')).toBe('A fila deste atendimento não tem o carrinho da Kentro ligado.');
  });

  it('loja com outra plataforma não mostra o botão', async () => {
    tela = await montarTela('atendimento/painel.html', {
      config,
      chat: { id: 55 },
      carrinho: {},
      respostas: { 'GET /v1/loja': { status: 200, body: { ...lojaOk.body, plataforma: 'shopify' } }, [rota(55)]: { status: 200, body: finalizadaKentro() } },
    });
    await tela.esperar(5);
    expect(tela.visivel('btn-carrinho-kentro')).toBe(false);
  });
});

describe('painel do atendimento — sessão do catálogo', () => {
  let tela: Tela;
  const montar = async (opcoes: Partial<OpcoesTela>) => {
    tela = await montarTela('atendimento/painel.html', { config, intervaloMs: 30, ...opcoes, respostas: { 'GET /v1/loja': lojaOk, ...opcoes.respostas } });
    await tela.esperar(5);
    return tela;
  };
  const consultas = (chatId: string | number) => tela.chamadas.filter((c) => c.url.endsWith(`/v1/sessoes/chat/${chatId}`)).length;
  afterEach(() => tela?.fechar());

  it('sem atendimento aberto pede para abrir um', async () => {
    await montar({ chat: null });
    expect(tela.visivel('sem-chat')).toBe(true);
    expect(tela.texto('status')).toBe('Conectado à loja Pisos & Cia.');
    expect(tela.chamadas.map((c) => c.url)).toEqual(['https://api.teste/v1/loja']);
  });

  it('sem sessão (404 pelo proxy da Kentro) mostra o botão; gerar envia chatId, nome e telefone do contato e copia o link', async () => {
    await montar({
      proxy: 'kentro',
      chat: { id: 55, contactId: 9, contact: { name: 'Ana', phone: '' } },
      contatos: { '9': { name: 'Ana Souza', phone: '+55 (38) 98888-7777' } },
      respostas: { [rota(55)]: semSessao, 'POST /v1/sessoes': { status: 201, body: sessao({ status: 'link_enviado', itens: [], abertaEm: null }) } },
    });
    expect(tela.visivel('sem-sessao')).toBe(true);
    // Como o servidor real: depois do POST a consulta do chat devolve a sessão criada.
    tela.respostas[rota(55)] = tela.respostas['POST /v1/sessoes'];
    await tela.clicar('btn-gerar');
    const post = tela.chamadas.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({ chatId: '55', nome: 'Ana Souza', telefone: '5538988887777' });
    expect(tela.visivel('com-sessao')).toBe(true);
    expect(tela.valor('link')).toBe('https://shop.teste/c/tok123');
    expect(tela.texto('status-sessao')).toBe('Link enviado');
    expect(tela.copiados).toEqual(['https://shop.teste/c/tok123']);
    expect(tela.toasts).toEqual(['Link copiado. Cole na conversa para enviar ao cliente.']);
  });

  it('pré-cadastro: envia e-mail, documento e endereço do contato da Kentro ao gerar o link', async () => {
    await montar({
      chat: { id: 56, contactId: 9 },
      contatos: {
        '9': {
          name: 'Ana Souza',
          phone: '5538988887777',
          email: 'ana@x.com',
          document: '123.456.789-00',
          postalCode: '39400-000',
          address: 'Rua A',
          houseNumber: '10',
          addressComplement: '',
          neighborhood: 'Centro',
          city: 'Montes Claros',
          state: 'mg',
        } as never,
      },
      respostas: { [rota(56)]: semSessao, 'POST /v1/sessoes': { status: 201, body: sessao({ status: 'link_enviado', itens: [] }) } },
    });
    tela.respostas[rota(56)] = tela.respostas['POST /v1/sessoes'];
    await tela.clicar('btn-gerar');
    const post = tela.chamadas.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({
      chatId: '56',
      nome: 'Ana Souza',
      telefone: '5538988887777',
      email: 'ana@x.com',
      documento: '123.456.789-00',
      endereco: { cep: '39400-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Montes Claros', estado: 'MG' },
    });
  });

  it('erro ao gerar o link aparece no aviso', async () => {
    await montar({
      chat: { id: 55 },
      respostas: { [rota(55)]: semSessao, 'POST /v1/sessoes': { status: 403, body: { erro: { codigo: 'LOJA_BLOQUEADA', mensagem: 'x' } } } },
    });
    await tela.clicar('btn-gerar');
    expect(tela.texto('aviso')).toBe('Esta loja está bloqueada no Kentro Shop. Fale com o administrador.');
    expect((tela.document.getElementById('btn-gerar') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sessão navegando mostra itens, totais com frete a combinar e a atividade; e segue consultando', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    expect(tela.texto('status-sessao')).toBe('Montando o carrinho');
    expect(tela.texto('itens')).toContain('Porcelanato Bege');
    expect(tela.texto('itens')).toContain('2 cx × R$ 129,90 · 2,88 m²');
    expect(tela.texto('carrinho-qtd')).toBe('2 itens');
    const frete = [...tela.document.querySelectorAll('#totais div')].find((d) => d.textContent?.startsWith('Frete'));
    expect(frete?.lastElementChild?.textContent).toBe('a combinar');
    expect(tela.texto('eventos')).toContain('Adicionou 2 caixas de Porcelanato Bege');
    expect(tela.visivel('secao-handoff')).toBe(false);
    const antes = consultas(55);
    await tela.esperar(100);
    expect(consultas(55)).toBeGreaterThan(antes);
  });

  it('finalizado mostra o handoff, avisa uma vez e para de consultar', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    tela.respostas[rota(55)] = { status: 200, body: finalizada() };
    await tela.esperar(80);
    expect(tela.texto('status-sessao')).toBe('Finalizado');
    expect(tela.visivel('secao-handoff')).toBe(true);
    expect(tela.texto('handoff')).toContain('Rua A, nº 10 — Centro — Montes Claros/MG');
    expect(tela.texto('handoff')).toContain('(38) 98888-7777');
    expect(tela.texto('handoff')).toContain('Entregar sábado');
    expect(tela.toasts).toEqual(['O cliente finalizou o pedido: R$ 259,80']);
    const depois = consultas(55);
    await tela.esperar(120);
    expect(consultas(55)).toBe(depois);
    await tela.clicar('btn-copiar-resumo');
    expect(tela.copiados).toEqual(['Resumo do atendimento\n\nCliente: Ana Souza']);
  });

  it('abrir um atendimento já finalizado não dispara o aviso', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: finalizada() } } });
    expect(tela.visivel('secao-handoff')).toBe(true);
    expect(tela.toasts).toEqual([]);
  });

  it('trocar de atendimento zera a tela e consulta o novo', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() }, [rota(77)]: semSessao } });
    expect(tela.visivel('com-sessao')).toBe(true);
    await tela.emitir('omniChatSelected', { id: 77 });
    expect(consultas(77)).toBe(1);
    expect(tela.visivel('com-sessao')).toBe(false);
    expect(tela.visivel('sem-sessao')).toBe(true);
    await tela.emitir('omniChatSelected', null);
    expect(tela.visivel('sem-chat')).toBe(true);
    expect(tela.visivel('sem-sessao')).toBe(false);
  });

  it('com a aba oculta pausa a consulta; ao voltar, consulta na hora', async () => {
    // Intervalo maior que o tempo das asserções: a consulta "na hora" não se confunde com a agendada.
    await montar({ intervaloMs: 250, chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    await tela.ocultar(true);
    const pausado = consultas(55);
    await tela.esperar(600);
    expect(consultas(55)).toBe(pausado);
    await tela.ocultar(false);
    expect(consultas(55)).toBe(pausado + 1);
  });

  it('link expirado mostra "Gerar novo link" e não fica consultando', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao({ expiraEm: new Date(Date.now() - 1000).toISOString() }) } } });
    expect(tela.texto('status-sessao')).toBe('Link expirado');
    expect(tela.visivel('btn-novo-link')).toBe(true);
    const total = consultas(55);
    await tela.esperar(100);
    expect(consultas(55)).toBe(total);
  });
});
