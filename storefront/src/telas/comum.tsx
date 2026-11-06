import { useState } from 'preact/hooks';
import { brl, iniciais } from '../formato';
import { precos } from '../precos';
import type { Produto, Variacao } from '../tipos';

const TONS = 6;

/** Tom fixo por nome: sem foto, a vitrine não vira um mar de quadrados iguais. */
function tomDoNome(nome: string): number {
  let soma = 0;
  for (const c of String(nome || '')) soma = (soma * 31 + c.charCodeAt(0)) >>> 0;
  return soma % TONS;
}

/** Imagem do produto; sem imagem (ou se falhar) mostra as iniciais do nome. */
export function Imagem({ src, nome, carregarDepois = true }: { src?: string | null; nome: string; carregarDepois?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) {
    return (
      <div class={`marcador tom-${tomDoNome(nome)}`} aria-hidden="true">
        {iniciais(nome)}
      </div>
    );
  }
  return <img src={src} alt="" loading={carregarDepois ? 'lazy' : undefined} onError={() => setFalhou(true)} />;
}

/** Sem preço na tela, a API manda preço 0: aí vale só a disponibilidade. */
export const vendavel = (v: { disponivel: boolean; preco: number }) => v.disponivel && (v.preco > 0 || !precos.visiveis());

export function produtoVendavel(p: Produto): boolean {
  return p.variacoes.length ? p.variacoes.some(vendavel) : vendavel(p);
}

export function primeiraVariacao(p: Produto): Variacao | null {
  return p.variacoes.find(vendavel) ?? p.variacoes[0] ?? null;
}

/** Preço do card: "de/por" no produto simples, "a partir de" quando as variações têm preços diferentes. */
export function faixaDePreco(p: Produto): { valor: number; de: number; aPartir: boolean } {
  if (!p.variacoes.length) return { valor: p.preco, de: p.precoDe && p.precoDe > p.preco ? p.precoDe : 0, aPartir: false };
  const candidatas = p.variacoes.filter(vendavel);
  const precos = (candidatas.length ? candidatas : p.variacoes).map((v) => v.preco);
  const min = Math.min(...precos);
  return { valor: min, de: 0, aPartir: Math.max(...precos) > min };
}

/** Desconto em % arredondado para baixo (nunca promete mais do que dá); a folga cobre o erro do ponto flutuante. */
export function percentualDeDesconto(de: number, por: number): number {
  if (!(de > por) || !(por > 0)) return 0;
  return Math.floor(((de - por) / de) * 100 + 1e-9);
}

/** "De R$ X" riscado com o selo "-N%": o cliente vê quanto economiza. Abaixo de 1% fica só o preço riscado. */
export function PrecoDe({ de, por }: { de: number; por: number }) {
  const pct = percentualDeDesconto(de, por);
  return (
    <div class="preco-de">
      De <s>{brl(de)}</s>
      {pct >= 1 && <span class="preco-desconto">-{pct}%</span>}
    </div>
  );
}

export function classeDoSelo(selo: string): string {
  if (/oferta|promo|desconto/i.test(selo)) return 'selo oferta';
  if (/últim|ultim/i.test(selo)) return 'selo alerta';
  return 'selo';
}
