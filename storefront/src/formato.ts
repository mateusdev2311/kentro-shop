// Formatação e contas do catálogo (só exibição: preço e total de verdade vêm do servidor).

export function brl(valor: number): string {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function num(valor: number): string {
  return Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
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
  M2: ['m²', 'm²'],
};

export function unidade(sigla: string, quantidade: number): string {
  const nomes = UNIDADES[String(sigla).toUpperCase()] ?? [String(sigla).toLowerCase(), String(sigla).toLowerCase()];
  return quantidade === 1 ? nomes[0] : nomes[1];
}

/** "caixa" e "unidade" são femininos: "2 caixas adicionadas". */
export function adicionado(sigla: string, quantidade: number): string {
  const feminino = /^(caixa|unidade|peça|lata)/.test(unidade(sigla, 1));
  return `adicionad${feminino ? 'a' : 'o'}${quantidade > 1 ? 's' : ''}`;
}

/** 5538988887777 → (38) 98888-7777 (o número vem da Kentro com DDI). */
export function telefone(t: string): string {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || '';
}

export function cep(t: string): string {
  const d = String(t || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

// Arredonda antes do ceil: 14,4 / 1,44 dá 10,000000000000002 em ponto flutuante e viraria 11.
const teto = (x: number) => Math.ceil(Number(x.toFixed(6)));

/** Caixas para cobrir a área (com 10% de perda opcional). */
export function caixasParaArea(area: number, m2PorCaixa: number, perda: boolean): number {
  if (!(area > 0) || !(m2PorCaixa > 0)) return 0;
  return teto((area * (perda ? 1.1 : 1)) / m2PorCaixa);
}

/** Quantidade de um "compre junto" (argamassa, rejunte…) para a metragem escolhida. */
export function quantidadeSugerida(m2Total: number, rendimentoM2: number | undefined): number {
  if (!(m2Total > 0) || !rendimentoM2 || !(rendimentoM2 > 0)) return 1;
  return Math.max(1, teto(m2Total / rendimentoM2));
}

export function primeiroNome(nome: string): string {
  return String(nome || '').trim().split(/\s+/)[0] ?? '';
}

/** Marcador da imagem ausente: "Porcelanato Bege" → "PB". */
export function iniciais(nome: string): string {
  return (
    String(nome || '')
      .split(/\s+/)
      .filter((p) => /^[\p{L}\d]/u.test(p) && p.length > 2)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('') || '?'
  );
}
