/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["require", "default"]}
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { criarApi } from '../../../storefront/src/api';
import { App } from '../../../storefront/src/app';
import type { Abertura, Produto, Sessao } from '../../../storefront/src/tipos';

// Servidor falso das rotas /v1/catalogo/:token (catálogo, carrinho e finalização).

const produto = (p: Partial<Produto> & { id: string; nome: string; preco: number }): Produto => ({
  sku: p.id,
  descricao: '',
  imagens: [],
  unidade: 'UN',
  estoque: 50,
  disponivel: true,
  categoriaIds: ['1'],
  variacoes: [],
  ...p,
});

const CATALOGO: Produto[] = [
  produto({ id: 'PISO', nome: 'Porcelanato Bege', preco: 100, unidade: 'CX', regras: { m2PorUnidade: 1.44, compreJunto: ['ARG'], selo: 'Oferta' } }),
  produto({
    id: 'TINTA',
    nome: 'Tinta Acrílica',
    preco: 80,
    variacoes: [
      { id: 'v1', sku: 'TINTA-B', nome: 'Branco', atributos: {}, preco: 80, estoque: 5, disponivel: true },
      { id: 'v2', sku: 'TINTA-P', nome: 'Preto', atributos: {}, preco: 90, estoque: 0, disponivel: false },
    ],
  }),
  produto({ id: 'ARG', nome: 'Argamassa AC3', preco: 30, unidade: 'SC', categoriaIds: ['2'], regras: { rendimentoM2: 4, compreJunto: [] } }),
];

interface Estado {
  abertura: Abertura;
  carrinho: { produtoId: string; variacaoId?: string; quantidade: number }[];
  chamadas: { metodo: string; caminho: string; corpo?: unknown }[];
  linkInvalido: boolean;
  precoMudaUmaVez: boolean;
  erroFinalizar?: { codigo: string; mensagem: string };
}

let estado: Estado;

function sessao(status: Sessao['status'] = 'navegando'): Sessao {
  const itens = estado.carrinho.map((i) => {
    const p = CATALOGO.find((x) => x.id === i.produtoId)!;
    const v = p.variacoes.find((x) => x.id === i.variacaoId);
    const preco = (v ?? p).preco;
    return {
      produtoId: p.id,
      variacaoId: v?.id ?? null,
      sku: (v ?? p).sku,
      nome: p.nome,
      variacaoNome: v?.nome ?? null,
      imagem: null,
      unidade: p.unidade,
      precoUnitario: preco,
      quantidade: i.quantidade,
      subtotal: preco * i.quantidade,
      m2: p.regras?.m2PorUnidade ? p.regras.m2PorUnidade * i.quantidade : null,
    };
  });
  const subtotal = itens.reduce((s, i) => s + i.subtotal, 0);
  return {
    ...estado.abertura.sessao,
    status,
    itens,
    totais: { itens: itens.reduce((s, i) => s + i.quantidade, 0), subtotal, frete: null, desconto: 0, total: subtotal },
  };
}

const json = (status: number, corpo: unknown) => ({ ok: status < 400, status, json: async () => corpo }) as unknown as Response;

async function servidor(url: string, init?: RequestInit): Promise<Response> {
  const metodo = init?.method ?? 'GET';
  const caminho = url.replace('/v1/catalogo/tok', '');
  const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
  estado.chamadas.push({ metodo, caminho, corpo });
  if (estado.linkInvalido) return json(404, { erro: { codigo: 'LINK_INVALIDO', mensagem: 'Este link não está mais disponível. Peça um novo link no WhatsApp.' } });
  if (caminho === '/abrir') return json(200, { ...estado.abertura, sessao: sessao(estado.abertura.sessao.status) });
  if (caminho === '/categorias') return json(200, [{ id: '1', nome: 'Pisos' }, { id: '2', nome: 'Argamassas' }]);
  if (caminho.startsWith('/produtos/')) return json(200, CATALOGO.find((p) => p.id === decodeURIComponent(caminho.slice(10))));
  if (caminho.startsWith('/produtos')) {
    const q = new URLSearchParams(caminho.split('?')[1] ?? '');
    const itens = CATALOGO.filter((p) => (!q.get('categoria') || p.categoriaIds.includes(q.get('categoria')!)) && (!q.get('busca') || p.nome.toLowerCase().includes(q.get('busca')!)));
    return json(200, { itens, pagina: 1, porPagina: 24, total: itens.length, temMais: false });
  }
  if (caminho === '/carrinho') {
    estado.carrinho = (corpo as { itens: Estado['carrinho'] }).itens;
    return json(200, { sessao: sessao(), avisos: [] });
  }
  if (caminho === '/frete') return json(200, { titulo: 'Entrega', valor: 15, prazo: 'Em até 3 dias úteis' });
  if (caminho === '/finalizar') {
    if (estado.erroFinalizar) return json(400, { erro: estado.erroFinalizar });
    if (estado.precoMudaUmaVez) {
      estado.precoMudaUmaVez = false;
      CATALOGO[0].preco = 110;
      return json(409, {
        erro: { codigo: 'PRECOS_ALTERADOS', mensagem: 'Mudou.' },
        diferencas: [{ sku: 'PISO', nome: 'Porcelanato Bege', antes: { preco: 100, quantidade: 2 }, depois: { preco: 110, quantidade: 2 } }],
        sessao: sessao(),
      });
    }
    const s = sessao('finalizado');
    const c = corpo as { tipo: string; entrega?: Record<string, string> };
    return json(200, {
      ...s,
      checkout: c.tipo === 'entrega' ? { tipo: 'entrega', entrega: { ...c.entrega, cep: '39400-000' }, observacoes: '' } : null,
    });
  }
  return json(404, { erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' } });
}

// ── Apoio ──────────────────────────────────────────────
let raiz: HTMLElement;
const buscarCep = jest.fn(async () => ({ rua: 'Rua das Flores', bairro: 'Centro', cidade: 'Montes Claros', estado: 'MG' }));

async function esperar(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function ate(condicao: () => boolean, limite = 3000) {
  const fim = Date.now() + limite;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`tempo esgotado. Tela: ${raiz.textContent?.slice(0, 600)}`);
    await esperar(10);
  }
}

const tem = (texto: string) => !!raiz.textContent?.includes(texto);
function elemento<T extends HTMLElement = HTMLElement>(seletor: string, texto?: string): T {
  const achado = [...raiz.querySelectorAll<T>(seletor)].find((e) => texto === undefined || e.textContent?.includes(texto) || e.getAttribute('aria-label') === texto);
  if (!achado) throw new Error(`não achei ${seletor} "${texto ?? ''}". Tela: ${raiz.textContent?.slice(0, 600)}`);
  return achado;
}
const clicar = (el: HTMLElement) => act(() => el.click());
function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  act(() => {
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const chamadas = (caminho: string, metodo?: string) => estado.chamadas.filter((c) => c.caminho === caminho && (!metodo || c.metodo === metodo));

async function montar() {
  raiz = document.createElement('div');
  document.body.appendChild(raiz);
  act(() => render(<App api={criarApi('tok', servidor as typeof fetch)} buscarCep={buscarCep} documento={null} />, raiz));
  if (!estado.linkInvalido) await ate(() => tem('Porcelanato Bege'));
}

beforeEach(() => {
  CATALOGO[0].preco = 100;
  buscarCep.mockClear();
  window.scrollTo = jest.fn();
  estado = {
    abertura: {
      sessao: {
        id: 's1',
        status: 'navegando',
        url: 'https://shop.teste/c/tok',
        cliente: { nome: 'Ana Souza', telefone: '5538988887777' },
        itens: [],
        totais: { itens: 0, subtotal: 0, frete: null, desconto: 0, total: 0 },
        checkout: null,
        abertaEm: null,
        finalizadaEm: null,
        expiraEm: '2030-01-01T00:00:00.000Z',
      },
      tema: { nome: 'Loja Teste', corPrimaria: '#0055aa' },
      entrega: { habilitada: true },
      retirada: { habilitada: false, lojas: [] },
      frete: { regra: 'a_combinar' },
    },
    carrinho: [],
    chamadas: [],
    linkInvalido: false,
    precoMudaUmaVez: false,
  };
});
afterEach(() => {
  act(() => render(null, raiz));
  raiz.remove();
});

describe('catálogo do cliente', () => {
  it('carrega a vitrine com a saudação, o tema e os cards', async () => {
    await montar();
    expect(tem('Loja Teste')).toBe(true);
    expect(tem('Olá, Ana! Catálogo exclusivo')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--cor-primaria')).toBe('#0055aa');
    expect(tem('3 produtos')).toBe(true);
    const piso = elemento('.produto', 'Porcelanato Bege');
    expect(piso.textContent).toContain('Oferta');
    expect(piso.textContent).toContain('R$ 69,44 o m²'); // 100 / 1,44
    // A variação esgotada (Preto, R$ 90) não entra na faixa: sem "a partir de".
    expect(elemento('.produto', 'Tinta Acrílica').textContent).not.toContain('a partir de');
    expect(elemento('.produto', 'Tinta Acrílica').textContent).toContain('R$ 80,00');
    expect(elemento('.produto', 'Porcelanato Bege').querySelector('.marcador')?.textContent).toBe('PB');
  });

  it('filtra por categoria e busca no servidor', async () => {
    await montar();
    clicar(elemento('.categorias button', 'Argamassas'));
    await ate(() => !tem('Porcelanato Bege'));
    expect(chamadas('/produtos?categoria=2')).toHaveLength(1);
    clicar(elemento('.categorias button', 'Todos'));
    await ate(() => tem('Porcelanato Bege'));
    digitar(elemento<HTMLInputElement>('input[type=search]'), 'tinta');
    await ate(() => !tem('Porcelanato Bege'));
    expect(chamadas('/produtos?busca=tinta')).toHaveLength(1);
  });

  it('adicionar pelo detalhe atualiza o contador e chama o PUT', async () => {
    await montar();
    clicar(elemento('.produto', 'Tinta Acrílica'));
    expect(elemento('.variacao', 'Preto').hasAttribute('disabled')).toBe(true);
    expect(tem('Últimas 5 unidades')).toBe(true);
    clicar(elemento('button', 'Adicionar'));
    expect(elemento('.contador').textContent).toBe('1');
    expect(tem('1 unidade adicionada ao carrinho')).toBe(true);
    await ate(() => chamadas('/carrinho', 'PUT').length === 1);
    expect(chamadas('/carrinho')[0].corpo).toEqual({ itens: [{ produtoId: 'TINTA', variacaoId: 'v1', quantidade: 1 }] });
  });

  it('a calculadora define a quantidade e o compre junto sugere pela metragem', async () => {
    await montar();
    clicar(elemento('.produto', 'Porcelanato Bege'));
    digitar(elemento<HTMLInputElement>('input', 'Área em m²'), '10');
    expect(elemento<HTMLInputElement>('input', 'Quantidade').value).toBe('8'); // 11 m² / 1,44
    expect(tem('8 caixas cobrem 11,52 m²')).toBe(true);
    await ate(() => tem('Compre junto'));
    expect(elemento('.sugestao', 'Argamassa AC3').textContent).toContain('Para 11,52 m²: 3 sacos');
    clicar(elemento('button', 'Adicionar'));
    clicar(elemento('button', 'Adicionar Argamassa AC3'));
    await ate(() => chamadas('/carrinho', 'PUT').length === 1);
    expect(chamadas('/carrinho')[0].corpo).toEqual({
      itens: [
        { produtoId: 'PISO', quantidade: 8 },
        { produtoId: 'ARG', quantidade: 3 },
      ],
    });
  });

  it('checkout de entrega envia os campos (com ViaCEP) e mostra a confirmação', async () => {
    estado.carrinho = [{ produtoId: 'PISO', quantidade: 2 }];
    estado.abertura.frete = { regra: 'fixo', valor: 15 };
    await montar();
    expect(elemento('.contador').textContent).toBe('2');
    clicar(elemento('.barra-carrinho button', 'Ver carrinho'));
    await ate(() => tem('Seu carrinho'));
    expect(tem('R$ 200,00')).toBe(true);
    clicar(elemento('button', 'Continuar'));
    expect(raiz.querySelector('[aria-pressed]')?.textContent).toContain('Entrega'); // só entrega: já escolhida
    expect(tem('Retirada')).toBe(false);
    expect(elemento<HTMLInputElement>('#f-nome').value).toBe('Ana Souza');
    expect(elemento<HTMLInputElement>('#f-telefone').value).toBe('(38) 98888-7777');
    digitar(elemento<HTMLInputElement>('#f-cep'), '39400000');
    expect(elemento<HTMLInputElement>('#f-cep').value).toBe('39400-000');
    await ate(() => elemento<HTMLInputElement>('#f-rua').value === 'Rua das Flores');
    await ate(() => tem('R$ 215,00')); // frete fixo cotado
    digitar(elemento<HTMLInputElement>('#f-numero'), '10');
    clicar(elemento('button', 'Enviar pedido para o atendente'));
    await ate(() => tem('Pedido enviado!'));
    const envio = chamadas('/finalizar')[0].corpo as { tipo: string; entrega: Record<string, string> };
    expect(envio.tipo).toBe('entrega');
    expect(envio.entrega).toMatchObject({ nome: 'Ana Souza', cep: '39400-000', rua: 'Rua das Flores', bairro: 'Centro', cidade: 'Montes Claros', estado: 'MG', numero: '10' });
    expect(tem('Você já pode voltar para a conversa no WhatsApp.')).toBe(true);
    expect(tem('Pedido enviado ao atendente')).toBe(true);
  });

  it('409 mostra as diferenças e confirmar reenvia', async () => {
    estado.carrinho = [{ produtoId: 'PISO', quantidade: 2 }];
    estado.precoMudaUmaVez = true;
    await montar();
    clicar(elemento('button', 'Ver carrinho'));
    await ate(() => tem('Continuar'));
    clicar(elemento('button', 'Continuar'));
    digitar(elemento<HTMLInputElement>('#f-numero'), '10');
    clicar(elemento('button', 'Enviar pedido para o atendente'));
    await ate(() => tem('Alguns itens mudaram'));
    expect(elemento('.diferencas li').textContent).toContain('R$ 100,00 → R$ 110,00');
    clicar(elemento('button', 'Confirmar e enviar'));
    await ate(() => tem('Pedido enviado!'));
    expect(chamadas('/finalizar')).toHaveLength(2);
    expect(chamadas('/finalizar')[1].corpo).toEqual(chamadas('/finalizar')[0].corpo);
  });

  it('erro do servidor na finalização aparece no formulário, que continua preenchido', async () => {
    estado.carrinho = [{ produtoId: 'PISO', quantidade: 1 }];
    estado.erroFinalizar = { codigo: 'ENTRADA_INVALIDA', mensagem: 'Preencha: Número.' };
    await montar();
    clicar(elemento('button', 'Ver carrinho'));
    await ate(() => tem('Continuar'));
    clicar(elemento('button', 'Continuar'));
    digitar(elemento<HTMLInputElement>('#f-bairro'), 'Centro');
    clicar(elemento('button', 'Enviar pedido para o atendente'));
    await ate(() => !!raiz.querySelector('[role=alert]'));
    expect(elemento('[role=alert]').textContent).toBe('Preencha: Número.');
    expect(elemento<HTMLInputElement>('#f-bairro').value).toBe('Centro');
    expect(elemento<HTMLButtonElement>('button', 'Enviar pedido para o atendente').disabled).toBe(false);
  });

  it('retirada aparece só quando a loja oferece, com as lojas', async () => {
    estado.carrinho = [{ produtoId: 'PISO', quantidade: 1 }];
    estado.abertura.retirada = { habilitada: true, lojas: [{ id: 'centro', nome: 'Loja Centro', endereco: 'Rua B, 2', horario: '8h-18h', orientacoes: 'Balcão 3' }] };
    await montar();
    clicar(elemento('button', 'Ver carrinho'));
    await ate(() => tem('Continuar'));
    clicar(elemento('button', 'Continuar'));
    expect(tem('Entrega')).toBe(true);
    clicar(elemento('.opcao', 'Retirada'));
    clicar(elemento('button', 'Enviar pedido para o atendente'));
    expect(elemento('[role=alert]').textContent).toBe('Escolha a loja para retirada.');
    clicar(elemento('.loja', 'Loja Centro'));
    expect(tem('Balcão 3')).toBe(true);
    clicar(elemento('button', 'Enviar pedido para o atendente'));
    await ate(() => chamadas('/finalizar').length === 1);
    expect(chamadas('/finalizar')[0].corpo).toEqual({ tipo: 'retirada', lojaRetiradaId: 'centro', observacoes: '' });
  });

  it('link inválido mostra a tela amigável', async () => {
    estado.linkInvalido = true;
    await montar();
    await ate(() => tem('Link indisponível'));
    expect(tem('Este link não está mais disponível. Peça um novo link no WhatsApp.')).toBe(true);
    expect(raiz.querySelector('button')).toBeNull();
  });

  it('pedido já finalizado abre direto na confirmação', async () => {
    estado.carrinho = [{ produtoId: 'PISO', quantidade: 1 }];
    estado.abertura.sessao.status = 'finalizado';
    await montar();
    expect(tem('Pedido enviado!')).toBe(true);
  });
});
