import { RegraFrete } from '../config-loja/config-loja.service';
import { Checkout, Cliente, Totais } from './tipos';

// Funções puras do carrinho: totais, frete pela regra da loja e o texto do resumo (handoff).

export function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Moeda com espaço comum (o resumo é colado em conversas, onde o espaço fixo atrapalha). */
export function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

function num(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

const UNIDADES: Record<string, [string, string]> = {
  CX: ['caixa', 'caixas'],
  SC: ['saco', 'sacos'],
  UN: ['unidade', 'unidades'],
  KIT: ['kit', 'kits'],
  RL: ['rolo', 'rolos'],
  PC: ['peça', 'peças'],
  KG: ['kg', 'kg'],
  LT: ['lata', 'latas'],
};

export function unidade(sigla: string, quantidade: number): string {
  const nomes = UNIDADES[sigla.toUpperCase()] ?? [sigla.toLowerCase(), sigla.toLowerCase()];
  return quantidade === 1 ? nomes[0] : nomes[1];
}

/** 5538988887777 → (38) 98888-7777. Número de fora do Brasil fica como veio. */
export function telefoneBr(telefone: string): string {
  let d = String(telefone || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone || '';
}

export function calcularTotais(itens: { precoUnitario: number; quantidade: number }[], frete: number | null, desconto = 0): Totais {
  const subtotal = arredondar(itens.reduce((soma, i) => soma + i.precoUnitario * i.quantidade, 0));
  return {
    itens: itens.reduce((soma, i) => soma + i.quantidade, 0),
    subtotal,
    frete,
    desconto,
    total: arredondar(subtotal - desconto + (frete ?? 0)),
  };
}

export function freteDaRegra(regra: RegraFrete, subtotal: number): { valor: number | null; titulo: string; prazo?: string } {
  const prazo = regra.prazo ? { prazo: regra.prazo } : {};
  if (regra.regra === 'fixo') return { valor: regra.valor, titulo: 'Entrega', ...prazo };
  if (regra.regra === 'gratis_acima_de') {
    return subtotal >= regra.minimo ? { valor: 0, titulo: 'Entrega grátis', ...prazo } : { valor: regra.valor, titulo: 'Entrega', ...prazo };
  }
  return { valor: null, titulo: 'Frete a combinar', ...prazo };
}

export interface ItemDoResumo {
  nome: string;
  variacaoNome: string | null;
  quantidade: number;
  unidade: string;
  precoUnitario: number;
  m2: number | null;
}

/** Texto do handoff para o atendente (mesmo formato validado na demo). */
export function resumoDoPedido(dados: { cliente: Cliente; checkout: Checkout | null; itens: ItemDoResumo[]; totais: Totais }): string {
  const { cliente, checkout, itens, totais } = dados;
  const linhas = [
    'Resumo do atendimento',
    '',
    `Cliente: ${cliente.nome || 'não informado'}`,
    `Telefone: ${telefoneBr(cliente.telefone) || 'não informado'}`,
  ];
  if (checkout?.tipo === 'entrega') {
    const e = checkout.entrega;
    linhas.push('Tipo: Entrega');
    linhas.push(`Endereço: ${e.rua}, nº ${e.numero}${e.complemento ? ` — ${e.complemento}` : ''} — ${e.bairro} — ${e.cidade}/${e.estado} — CEP ${e.cep}`);
    if (e.referencia) linhas.push(`Referência: ${e.referencia}`);
  } else if (checkout?.tipo === 'retirada') {
    linhas.push('Tipo: Retirada');
    linhas.push(`Loja: ${checkout.loja.nome} (${checkout.loja.endereco})`);
  } else {
    linhas.push('Tipo: ainda não escolhido');
  }
  linhas.push('', 'Produtos:');
  for (const i of itens) {
    const variacao = i.variacaoNome ? ` (${i.variacaoNome})` : '';
    const m2 = i.m2 ? ` (${num(i.m2)} m²)` : '';
    linhas.push(`• ${i.nome}${variacao} — ${i.quantidade} ${unidade(i.unidade, i.quantidade)}${m2} — ${moeda(arredondar(i.precoUnitario * i.quantidade))}`);
  }
  linhas.push('', `Subtotal: ${moeda(totais.subtotal)}`);
  if (checkout?.tipo === 'entrega') {
    linhas.push(`Frete: ${totais.frete === null ? 'a combinar' : totais.frete === 0 ? 'grátis' : moeda(totais.frete)}`);
  }
  if (totais.desconto > 0) linhas.push(`Desconto: -${moeda(totais.desconto)}`);
  linhas.push(`Total: ${moeda(totais.total)}`);
  if (checkout?.observacoes) linhas.push('', `Observações: ${checkout.observacoes}`);
  return linhas.join('\n');
}
