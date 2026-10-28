import { montarTela, OpcoesTela, Tela } from './omni-falso';

// Painel do atendimento: o atendente monta o carrinho, ajusta, fecha o pedido pelo painel (sem o cliente passar
// pelo checkout) e acompanha ou cancela o pedido que entrou no sistema da loja (ERP).

const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_abc' };
const lojaOk = { status: 200, body: { id: 'l1', nome: 'Farmácia Centro', status: 'ativa', plano: 'gratis', papel: 'atendimento', plataforma: 'automatiza' } };
const agora = new Date().toISOString();
const futuro = new Date(Date.now() + 86_400_000).toISOString();

const item = (quantidade: number) => ({
  produtoId: '101',
  variacaoId: null,
  sku: '101',
  nome: 'SABONETE NEUTRO 90G',
  variacaoNome: null,
  imagem: null,
  unidade: 'UN',
  precoUnitario: 3.99,
  quantidade,
  subtotal: Math.round(3.99 * quantidade * 100) / 100,
  m2: null,
});

function sessao(extra: Record<string, unknown> = {}) {
  return {
    id: 's1',
    status: 'link_enviado',
    url: 'https://shop.teste/c/tok123',
    cliente: { nome: 'Ana Souza', telefone: '5538988887777' },
    itens: [item(2)],
    totais: { itens: 2, subtotal: 7.98, frete: null, desconto: 0, total: 7.98 },
    checkout: null,
    eventos: [],
    resumo: 'Resumo do atendimento',
    abertaEm: null,
    finalizadaEm: null,
    expiraEm: futuro,
    pedido: null,
    ...extra,
  };
}

const CHECKOUT = {
  tipo: 'entrega',
  entrega: { nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '35790-000', estado: 'MG', cidade: 'Curvelo', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: '', referencia: '' },
  observacoes: '',
  pagamento: { forma: 'dinheiro', trocoPara: 50 },
};
const pedidoCriado = (pedido: Record<string, unknown> = {}) =>
  sessao({
    status: 'pedido_criado',
    finalizadaEm: agora,
    checkout: CHECKOUT,
    totais: { itens: 3, subtotal: 11.97, frete: null, desconto: 0, total: 11.97 },
    itens: [item(3)],
    eventos: [{ em: agora, texto: 'Ana finalizou o pedido pelo painel (entrega) — R$ 11,97', autor: 'atendente' }],
    pedido: { idExterno: '7-107834', numero: '107834', status: 'ATIVO', acompanhar: true, cancelavel: true, ...pedido },
  });

const PRODUTOS = {
  status: 200,
  body: { itens: [{ id: '101', sku: '101', nome: 'SABONETE NEUTRO 90G', preco: 3.99, unidade: 'UN', disponivel: true, variacoes: [], imagens: [], categoriaIds: [] }], pagina: 1, porPagina: 24, temMais: false },
};
const OPCOES = { status: 200, body: { entrega: { habilitada: true }, retirada: { habilitada: false, lojas: [] }, frete: { regra: 'a_combinar' }, pedidoNaLoja: true, pagamentoNaEntrega: true } };

describe('painel do atendimento — fechar o pedido pelo painel e acompanhar na loja', () => {
  let tela: Tela;
  afterEach(() => tela?.fechar());

  async function montar(extra: Partial<OpcoesTela> = {}) {
    tela = await montarTela('atendimento/painel.html', {
      config,
      intervaloMs: 60_000,
      chat: { id: 57, contactId: 9 },
      contatos: { '9': { name: 'Ana Souza', phone: '5538988887777' } },
      ...extra,
      respostas: {
        'GET /v1/loja': lojaOk,
        'GET /v1/sessoes/chat/57': { status: 404, body: { erro: { codigo: 'SEM_SESSAO', mensagem: 'Nenhum link.' } } },
        'GET /v1/loja/catalogo/produtos': PRODUTOS,
        'GET /v1/loja/catalogo/categorias': { status: 200, body: [] },
        'GET /v1/sessoes/historico': { status: 200, body: { enderecos: [], pedidos: [] } },
        'GET /v1/sessoes/opcoes-pedido': OPCOES,
        'POST /v1/sessoes': { status: 201, body: { ...sessao(), avisos: [] } },
        'PUT /v1/sessoes/s1/carrinho': { status: 200, body: { sessao: sessao({ itens: [item(3)], totais: { itens: 3, subtotal: 11.97, frete: null, desconto: 0, total: 11.97 } }), avisos: [] } },
        'POST /v1/sessoes/s1/finalizar': { status: 200, body: pedidoCriado() },
        'POST /v1/sessoes/s1/pedido/atualizar': { status: 200, body: pedidoCriado({ descricao: 'Enviado, aguardando a loja receber' }) },
        'POST /v1/sessoes/s1/pedido/cancelar': { status: 200, body: pedidoCriado({ status: 'CANCELADO', descricao: 'Cancelado', cancelavel: false }) },
        ...extra.respostas,
      },
    });
    await tela.esperar(5);
    return tela;
  }
  const corpo = (metodo: string, trecho: string) => JSON.parse(tela.chamadas.filter((c) => c.method === metodo && c.url.includes(trecho)).at(-1)!.body!);
  const clicarEm = async (seletor: string) => {
    (tela.document.querySelector(seletor) as HTMLElement).dispatchEvent(new tela.document.defaultView!.MouseEvent('click', { bubbles: true }));
    await tela.esperar(5);
  };

  it('sem link: monta o carrinho, ajusta a quantidade e fecha o pedido com o pagamento, sem copiar link', async () => {
    await montar();
    expect(tela.visivel('acao-montar-aqui')).toBe(true);
    await tela.clicar('btn-buscar');
    await clicarEm('[data-adicionar="101"]');
    await tela.clicar('btn-montar-aqui');
    expect(corpo('POST', '/v1/sessoes')).toMatchObject({ chatId: '57', nome: 'Ana Souza', itens: [{ produtoId: '101', quantidade: 1 }] });
    expect(tela.copiados).toEqual([]); // o link não é copiado: o atendente fecha aqui

    // Fechar o pedido aparece aberto, com o nome e o telefone do contato.
    expect(tela.visivel('secao-fechar')).toBe(true);
    expect((tela.document.getElementById('secao-fechar') as HTMLDetailsElement).open).toBe(true);
    expect(tela.valor('fp-nome')).toBe('Ana Souza');
    expect(tela.valor('fp-telefone')).toBe('(38) 98888-7777');
    expect((tela.document.getElementById('fp-entrega') as HTMLInputElement).checked).toBe(true); // só entrega na loja
    expect(tela.visivel('fp-bloco-pagamento')).toBe(true);
    expect(tela.visivel('fp-bloco-email')).toBe(false);
    expect(tela.texto('fp-botao')).toBe('Finalizar e enviar para a loja');

    await clicarEm('[data-qtd-item="0"][data-delta="1"]');
    expect(corpo('PUT', '/carrinho')).toEqual({ itens: [{ produtoId: '101', quantidade: 3 }] });

    await tela.clicar('btn-finalizar');
    expect(tela.texto('fp-aviso')).toBe('Escolha a forma de pagamento.');
    for (const [campo, valor] of Object.entries({ cep: '35790-000', estado: 'MG', cidade: 'Curvelo', bairro: 'Centro', rua: 'Rua A', numero: '10' })) tela.preencher(`fp-${campo}`, valor);
    tela.preencher('fp-forma', 'dinheiro');
    tela.document.getElementById('fp-forma')!.dispatchEvent(new tela.document.defaultView!.Event('change'));
    expect(tela.visivel('fp-bloco-troco')).toBe(true);
    tela.preencher('fp-troco', '50,00');
    await tela.clicar('btn-finalizar');

    expect(corpo('POST', '/finalizar')).toEqual({
      tipo: 'entrega',
      observacoes: '',
      entrega: { nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '35790-000', estado: 'MG', cidade: 'Curvelo', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: '', referencia: '' },
      pagamento: { forma: 'dinheiro', trocoPara: 50 },
    });
    expect(tela.toasts).toContain('Pedido nº 107834 enviado para a loja.');
    expect(tela.toasts.some((t) => t.startsWith('O cliente finalizou'))).toBe(false);
    expect(tela.visivel('secao-fechar')).toBe(false);
    expect(tela.texto('status-texto')).toBe('O pedido entrou no sistema da loja.');
    // Ao aparecer o pedido, o painel lê a situação na loja.
    expect(tela.chamadas.some((c) => c.url.endsWith('/v1/sessoes/s1/pedido/atualizar'))).toBe(true);
    expect(tela.texto('handoff')).toContain('nº 107834 · Enviado, aguardando a loja receber');
    expect(tela.texto('handoff')).toContain('Dinheiro na entrega (troco para R$');
    expect(tela.visivel('btn-cancelar-pedido')).toBe(true);
  });

  it('cancela o pedido na loja depois de confirmar; sem confirmar, nada é enviado', async () => {
    await montar({ respostas: { 'GET /v1/sessoes/chat/57': { status: 200, body: pedidoCriado() } }, confirmar: false });
    await tela.clicar('btn-cancelar-pedido');
    expect(tela.chamadas.some((c) => c.url.endsWith('/pedido/cancelar'))).toBe(false);
    tela.fechar();

    await montar({ respostas: { 'GET /v1/sessoes/chat/57': { status: 200, body: pedidoCriado() } } });
    await tela.clicar('btn-cancelar-pedido');
    expect(tela.chamadas.some((c) => c.method === 'POST' && c.url.endsWith('/v1/sessoes/s1/pedido/cancelar'))).toBe(true);
    expect(tela.toasts).toContain('Pedido nº 107834 cancelado na loja.');
    expect(tela.texto('handoff')).toContain('nº 107834 · Cancelado');
    expect(tela.visivel('btn-cancelar-pedido')).toBe(false);
  });

  it('a loja recusou o cancelamento (já em separação): o motivo aparece', async () => {
    await montar({
      respostas: {
        'GET /v1/sessoes/chat/57': { status: 200, body: pedidoCriado() },
        'POST /v1/sessoes/s1/pedido/cancelar': {
          status: 422,
          body: { erro: { codigo: 'RECUSADO_PELA_PLATAFORMA', mensagem: 'O pedido já está em separação na loja: o cancelamento precisa ser feito pela loja.' } },
        },
      },
    });
    await tela.clicar('btn-cancelar-pedido');
    expect(tela.texto('aviso')).toBe('O pedido já está em separação na loja: o cancelamento precisa ser feito pela loja.');
  });

  it('preço mudou ao fechar: mostra o que mudou e recarrega o carrinho', async () => {
    await montar({
      respostas: {
        'GET /v1/sessoes/chat/57': { status: 200, body: sessao() },
        'POST /v1/sessoes/s1/finalizar': {
          status: 409,
          body: {
            erro: { codigo: 'PRECOS_ALTERADOS', mensagem: 'Mudou.' },
            diferencas: [{ sku: '101', nome: 'SABONETE NEUTRO 90G', antes: { preco: 3.99, quantidade: 2 }, depois: { preco: 4.49, quantidade: 2 } }],
          },
        },
      },
    });
    tela.preencher('fp-forma', 'pix');
    for (const [campo, valor] of Object.entries({ cep: '35790-000', estado: 'MG', cidade: 'Curvelo', bairro: 'Centro', rua: 'Rua A', numero: '10' })) tela.preencher(`fp-${campo}`, valor);
    const consultasAntes = tela.chamadas.filter((c) => c.url.endsWith('/v1/sessoes/chat/57')).length;
    await tela.clicar('btn-finalizar');
    expect(tela.texto('fp-aviso').replace(/ /g, ' ')).toBe(
      'Mudou desde que o carrinho foi montado: SABONETE NEUTRO 90G: R$ 3,99 → R$ 4,49. O carrinho foi atualizado; confira e finalize de novo.',
    );
    expect(tela.chamadas.filter((c) => c.url.endsWith('/v1/sessoes/chat/57')).length).toBe(consultasAntes + 1);
  });
});
