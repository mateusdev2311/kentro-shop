import { arredondar, calcularTotais, freteDaRegra, moeda, resumoDoPedido, telefoneBr, unidade } from '../src/sessoes/calculo';

describe('cálculos do carrinho', () => {
  it('arredonda em centavos', () => {
    expect(arredondar(0.1 + 0.2)).toBe(0.3);
    expect(arredondar(129.905)).toBe(129.91);
  });

  it('formata moeda com espaço comum (o texto é colado em conversas)', () => {
    expect(moeda(1234.5)).toBe('R$ 1.234,50');
  });

  it('nomeia unidades no singular e plural', () => {
    expect(unidade('CX', 1)).toBe('caixa');
    expect(unidade('CX', 2)).toBe('caixas');
    expect(unidade('SC', 3)).toBe('sacos');
    expect(unidade('M2', 2)).toBe('m2');
  });

  it('formata o telefone que vem da Kentro com DDI', () => {
    expect(telefoneBr('5538988887777')).toBe('(38) 98888-7777');
    expect(telefoneBr('3832221111')).toBe('(38) 3222-1111');
    expect(telefoneBr('+1 555 0100')).toBe('+1 555 0100');
  });

  it('soma itens, frete e desconto', () => {
    const itens = [
      { precoUnitario: 10.5, quantidade: 2 },
      { precoUnitario: 5, quantidade: 1 },
    ];
    expect(calcularTotais(itens, 89.9)).toEqual({ itens: 3, subtotal: 26, frete: 89.9, desconto: 0, total: 115.9 });
    expect(calcularTotais(itens, null)).toEqual({ itens: 3, subtotal: 26, frete: null, desconto: 0, total: 26 });
    expect(calcularTotais(itens, 0, 6)).toMatchObject({ desconto: 6, total: 20 });
  });

  it('aplica as três regras de frete', () => {
    expect(freteDaRegra({ regra: 'a_combinar' }, 100)).toEqual({ valor: null, titulo: 'Frete a combinar' });
    expect(freteDaRegra({ regra: 'fixo', valor: 30, prazo: 'Em até 2 dias úteis' }, 100)).toEqual({
      valor: 30,
      titulo: 'Entrega',
      prazo: 'Em até 2 dias úteis',
    });
    const gratis = { regra: 'gratis_acima_de' as const, valor: 89.9, minimo: 2000 };
    expect(freteDaRegra(gratis, 1999.99)).toEqual({ valor: 89.9, titulo: 'Entrega' });
    expect(freteDaRegra(gratis, 2000)).toEqual({ valor: 0, titulo: 'Entrega grátis' });
  });
});

describe('resumo do pedido (handoff)', () => {
  const itens = [
    { nome: 'Porcelanato Calacata', variacaoNome: null, quantidade: 2, unidade: 'CX', precoUnitario: 129.9, m2: 2.88 },
    { nome: 'Vinílico Click', variacaoNome: 'Natural', quantidade: 1, unidade: 'CX', precoUnitario: 169.9, m2: null },
  ];

  it('entrega com endereço, frete e observações', () => {
    const texto = resumoDoPedido({
      cliente: { nome: 'Ana Souza', telefone: '5538988887777' },
      checkout: {
        tipo: 'entrega',
        entrega: {
          nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '39400-000', estado: 'MG', cidade: 'Montes Claros',
          bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: 'ap 2', referencia: 'Perto da praça',
        },
        observacoes: 'Entregar sábado',
      },
      itens,
      totais: calcularTotais(itens, 89.9),
    });
    expect(texto).toBe(
      [
        'Resumo do atendimento',
        '',
        'Cliente: Ana Souza',
        'Telefone: (38) 98888-7777',
        'Tipo: Entrega',
        'Endereço: Rua A, nº 10 — ap 2 — Centro — Montes Claros/MG — CEP 39400-000',
        'Referência: Perto da praça',
        '',
        'Produtos:',
        '• Porcelanato Calacata — 2 caixas (2,88 m²) — R$ 259,80',
        '• Vinílico Click (Natural) — 1 caixa — R$ 169,90',
        '',
        'Subtotal: R$ 429,70',
        'Frete: R$ 89,90',
        'Total: R$ 519,60',
        '',
        'Observações: Entregar sábado',
      ].join('\n'),
    );
  });

  it('retirada e frete a combinar', () => {
    const retirada = resumoDoPedido({
      cliente: { nome: '', telefone: '' },
      checkout: { tipo: 'retirada', loja: { id: 'c', nome: 'Loja Centro', endereco: 'Rua B, 2', horario: '', orientacoes: '' }, observacoes: '' },
      itens: [itens[0]],
      totais: calcularTotais([itens[0]], 0),
    });
    expect(retirada).toContain('Cliente: não informado');
    expect(retirada).toContain('Tipo: Retirada\nLoja: Loja Centro (Rua B, 2)');
    expect(retirada).not.toContain('Frete');

    const aCombinar = resumoDoPedido({
      cliente: { nome: 'Ana', telefone: '' },
      checkout: { tipo: 'entrega', entrega: { nome: 'Ana', telefone: '1', cep: '1', estado: 'MG', cidade: 'C', bairro: 'B', rua: 'R', numero: '1', complemento: '', referencia: '' }, observacoes: '' },
      itens: [itens[0]],
      totais: calcularTotais([itens[0]], null),
    });
    expect(aCombinar).toContain('Frete: a combinar');
  });

  it('antes da finalização mostra que o tipo ainda não foi escolhido', () => {
    expect(resumoDoPedido({ cliente: { nome: 'Ana', telefone: '' }, checkout: null, itens: [], totais: calcularTotais([], null) })).toContain(
      'Tipo: ainda não escolhido',
    );
  });
});
