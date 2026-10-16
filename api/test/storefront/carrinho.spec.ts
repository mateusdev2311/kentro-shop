import { criarApi } from '../../../storefront/src/api';
import { ATRASO_SINCRONIA, criarCarrinho, DocumentoVisivel } from '../../../storefront/src/carrinho';
import type { PedidoDeItem, Sessao } from '../../../storefront/src/tipos';

function sessao(itens: { produtoId: string; variacaoId?: string; quantidade: number }[] = [], status: Sessao['status'] = 'navegando'): Sessao {
  return {
    id: 's1',
    status,
    url: 'https://shop.teste/c/x',
    cliente: { nome: 'Ana', telefone: '' },
    itens: itens.map((i) => ({
      produtoId: i.produtoId,
      variacaoId: i.variacaoId ?? null,
      sku: i.produtoId,
      nome: i.produtoId,
      variacaoNome: null,
      imagem: null,
      unidade: 'UN',
      precoUnitario: 10,
      quantidade: i.quantidade,
      subtotal: 10 * i.quantidade,
      m2: null,
    })),
    totais: { itens: 0, subtotal: 0, frete: null, desconto: 0, total: 0 },
    checkout: null,
    abertaEm: null,
    finalizadaEm: null,
    expiraEm: '2030-01-01T00:00:00.000Z',
  };
}

/** Promessa que o teste resolve na hora que quiser (para simular respostas fora de ordem). */
function adiada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

function documentoFalso() {
  let ouvinte: (() => void) | null = null;
  const doc = {
    hidden: false,
    addEventListener: (_t: string, f: () => void) => (ouvinte = f),
    removeEventListener: () => (ouvinte = null),
    mudar(oculto: boolean) {
      doc.hidden = oculto;
      ouvinte?.();
    },
  };
  return doc as typeof doc & DocumentoVisivel;
}

const respostaDe = (itens: PedidoDeItem[]) => ({ sessao: sessao(itens.map((i) => ({ ...i }))), avisos: [] as string[] });

describe('estado do carrinho', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function montar() {
    const salvarCarrinho = jest.fn(async (itens: PedidoDeItem[]) => respostaDe(itens));
    const abrir = jest.fn();
    const avisos: string[] = [];
    const doc = documentoFalso();
    const carrinho = criarCarrinho({ salvarCarrinho, abrir } as never, { aoMudar: () => undefined, aoAviso: (t) => avisos.push(t) }, doc);
    carrinho.aplicar(sessao());
    return { carrinho, salvarCarrinho, abrir, avisos, doc };
  }

  it('debounce junta 3 cliques num PUT só', async () => {
    const { carrinho, salvarCarrinho } = montar();
    carrinho.somar('A', null, 1);
    carrinho.somar('A', null, 1);
    carrinho.somar('B', 'v1', 1);
    expect(carrinho.quantidade('A')).toBe(2); // otimista
    expect(carrinho.totalItens).toBe(3);
    expect(salvarCarrinho).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA);
    expect(salvarCarrinho).toHaveBeenCalledTimes(1);
    expect(salvarCarrinho).toHaveBeenCalledWith([
      { produtoId: 'A', quantidade: 2 },
      { produtoId: 'B', variacaoId: 'v1', quantidade: 1 },
    ]);
    expect(carrinho.pendente).toBe(false);
  });

  it('resposta fora de ordem é descartada', async () => {
    const { carrinho, salvarCarrinho } = montar();
    const primeira = adiada<ReturnType<typeof respostaDe>>();
    const segunda = adiada<ReturnType<typeof respostaDe>>();
    salvarCarrinho.mockReturnValueOnce(primeira.promessa).mockReturnValueOnce(segunda.promessa);

    carrinho.alterar('A', null, 1);
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA);
    carrinho.alterar('A', null, 5);
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA);

    segunda.resolver(respostaDe([{ produtoId: 'A', quantidade: 5 }]));
    await Promise.resolve();
    primeira.resolver(respostaDe([{ produtoId: 'A', quantidade: 1 }]));
    await jest.advanceTimersByTimeAsync(0);
    expect(carrinho.quantidade('A')).toBe(5);
    expect(carrinho.sessao?.itens[0].quantidade).toBe(5);
  });

  it('o servidor é a verdade: estoque limitado e avisos', async () => {
    const { carrinho, salvarCarrinho, avisos } = montar();
    salvarCarrinho.mockResolvedValueOnce({ sessao: sessao([{ produtoId: 'A', quantidade: 3 }]), avisos: ['Só temos 3 unidades de A.'] });
    carrinho.alterar('A', null, 10);
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA);
    expect(carrinho.quantidade('A')).toBe(3);
    expect(avisos).toEqual(['Só temos 3 unidades de A.']);
  });

  it('esconder a aba com alteração pendente envia na hora; voltar sem pendência recarrega', async () => {
    const { carrinho, salvarCarrinho, abrir, doc } = montar();
    carrinho.alterar('A', null, 2);
    doc.mudar(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(salvarCarrinho).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA * 2);
    expect(salvarCarrinho).toHaveBeenCalledTimes(1); // o debounce não manda de novo

    abrir.mockResolvedValueOnce({ sessao: sessao([{ produtoId: 'A', quantidade: 7 }]) });
    doc.mudar(false);
    await jest.advanceTimersByTimeAsync(0);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(carrinho.quantidade('A')).toBe(7);
  });

  it('pedido já enviado não deixa mexer', async () => {
    const { carrinho, salvarCarrinho, avisos } = montar();
    carrinho.aplicar(sessao([], 'finalizado'));
    carrinho.alterar('A', null, 1);
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA);
    expect(salvarCarrinho).not.toHaveBeenCalled();
    expect(avisos).toEqual(['Seu pedido já foi enviado ao atendente.']);
  });

  it('erro do servidor vira aviso e o carrinho não some', async () => {
    const { carrinho, salvarCarrinho, avisos } = montar();
    salvarCarrinho.mockRejectedValueOnce({ status: 502, codigo: 'PLATAFORMA_INDISPONIVEL', mensagem: 'A loja não respondeu.' });
    carrinho.alterar('A', null, 2);
    await expect(carrinho.sincronizarJa()).resolves.toBe(false);
    expect(avisos).toEqual(['A loja não respondeu.']);
    expect(carrinho.quantidade('A')).toBe(2);
  });

  it('sincronizarJa espera o envio que já está em voo', async () => {
    const { carrinho, salvarCarrinho } = montar();
    const envio = adiada<ReturnType<typeof respostaDe>>();
    salvarCarrinho.mockReturnValueOnce(envio.promessa);
    carrinho.alterar('A', null, 2);
    await jest.advanceTimersByTimeAsync(ATRASO_SINCRONIA); // o envio sai pelo debounce e fica em voo
    let terminou = false;
    const espera = carrinho.sincronizarJa().then((ok) => (terminou = ok));
    await jest.advanceTimersByTimeAsync(0);
    expect(terminou).toBe(false);
    envio.resolver(respostaDe([{ produtoId: 'A', quantidade: 2 }]));
    await espera;
    expect(terminou).toBe(true);
    expect(salvarCarrinho).toHaveBeenCalledTimes(1);
  });
});

describe('cliente da API do catálogo', () => {
  const resposta = (status: number, corpo: unknown) =>
    ({ ok: status < 400, status, json: async () => corpo }) as unknown as Response;

  it('monta as URLs com o token e envia JSON', async () => {
    const fetchFn = jest.fn(async () => resposta(200, { itens: [] }));
    const api = criarApi('tok/en', fetchFn as never);
    await api.produtos({ busca: 'piso bege', categoria: '3', pagina: 2 });
    await api.salvarCarrinho([{ produtoId: 'A', quantidade: 1 }]);
    expect(fetchFn.mock.calls[0]).toEqual(['/v1/catalogo/tok%2Fen/produtos?busca=piso+bege&categoria=3&pagina=2', { method: 'GET', headers: {}, body: undefined }]);
    expect(fetchFn.mock.calls[1]).toEqual([
      '/v1/catalogo/tok%2Fen/carrinho',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"itens":[{"produtoId":"A","quantidade":1}]}' },
    ]);
  });

  it('erros viram { status, codigo, mensagem, diferencas }', async () => {
    const diferencas = [{ sku: 'A1', nome: 'A', antes: { preco: 1, quantidade: 1 }, depois: null }];
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(resposta(409, { erro: { codigo: 'PRECOS_ALTERADOS', mensagem: 'Mudou.' }, diferencas, sessao: { id: 's' } }))
      .mockResolvedValueOnce(resposta(500, null))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const api = criarApi('t', fetchFn);
    await expect(api.finalizar({ tipo: 'retirada', lojaRetiradaId: 'x', observacoes: '' })).rejects.toEqual({
      status: 409,
      codigo: 'PRECOS_ALTERADOS',
      mensagem: 'Mudou.',
      diferencas,
      sessao: { id: 's' },
    });
    await expect(api.abrir()).rejects.toMatchObject({ status: 500, mensagem: 'Não foi possível concluir. Tente de novo.' });
    await expect(api.abrir()).rejects.toMatchObject({ status: 0, codigo: 'SEM_CONEXAO' });
  });
});
