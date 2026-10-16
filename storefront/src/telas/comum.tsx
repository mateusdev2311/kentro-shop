import { useState } from 'preact/hooks';
import { iniciais } from '../formato';
import { precos } from '../precos';
import type { Produto, Variacao } from '../tipos';

/** Imagem do produto; sem imagem (ou se falhar) mostra as iniciais do nome. */
export function Imagem({ src, nome, carregarDepois = true }: { src?: string | null; nome: string; carregarDepois?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) {
    return (
      <div class="marcador" aria-hidden="true">
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

export function classeDoSelo(selo: string): string {
  if (/oferta|promo|desconto/i.test(selo)) return 'selo oferta';
  if (/últim|ultim/i.test(selo)) return 'selo alerta';
  return 'selo';
}
