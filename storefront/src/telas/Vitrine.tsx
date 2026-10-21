import { useEffect, useRef } from 'preact/hooks';
import { brl, unidade } from '../formato';
import { precos } from '../precos';
import type { Produto } from '../tipos';
import { classeDoSelo, faixaDePreco, Imagem, produtoVendavel } from './comum';

interface Props {
  produtos: Produto[];
  noCarrinho: (produtoId: string) => number;
  aoAbrir: (produto: Produto) => void;
  temMais: boolean;
  carregando: boolean;
  erro: string;
  aoCarregarMais: () => void;
  layout?: 'grade' | 'lista';
}

export function Vitrine({ produtos, noCarrinho, aoAbrir, temMais, carregando, erro, aoCarregarMais, layout = 'grade' }: Props) {
  if (!produtos.length) {
    if (carregando) return <p class="carregando">Carregando produtos…</p>;
    if (erro) return <p class="vazio">{erro}</p>;
    return <p class="vazio">Nenhum produto encontrado. Tente outra palavra ou fale com a gente no WhatsApp.</p>;
  }
  return (
    <>
      <div class={layout === 'lista' ? 'grade lista' : 'grade'}>
        {produtos.map((p) => (
          <Cartao key={p.id} produto={p} quantidade={noCarrinho(p.id)} aoAbrir={aoAbrir} />
        ))}
      </div>
      {erro && <p class="vazio">{erro}</p>}
      {temMais && <Sentinela carregando={carregando} aoVer={aoCarregarMais} />}
    </>
  );
}

/** Fim da vitrine de um link: "Compre também" (mesmas categorias, fora da seleção e do carrinho) e "Ver todos". */
export function CompreTambem({
  produtos,
  noCarrinho,
  aoAbrir,
  aoVerTodos,
  layout = 'grade',
}: {
  produtos: Produto[];
  noCarrinho: (produtoId: string) => number;
  aoAbrir: (produto: Produto) => void;
  aoVerTodos: () => void;
  layout?: 'grade' | 'lista';
}) {
  return (
    <section class="compre-tambem" aria-labelledby="compre-tambem-titulo">
      {produtos.length > 0 && (
        <>
          <h2 id="compre-tambem-titulo">Compre também</h2>
          <div class={layout === 'lista' ? 'grade lista' : 'grade'}>
            {produtos.map((p) => (
              <Cartao key={p.id} produto={p} quantidade={noCarrinho(p.id)} aoAbrir={aoAbrir} />
            ))}
          </div>
        </>
      )}
      <div class="ver-todos">
        <button type="button" class="botao" onClick={aoVerTodos}>
          Ver todos os produtos
        </button>
      </div>
    </section>
  );
}

function Cartao({ produto: p, quantidade, aoAbrir }: { produto: Produto; quantidade: number; aoAbrir: (p: Produto) => void }) {
  const f = faixaDePreco(p);
  const m2 = p.regras?.m2PorUnidade;
  const comPreco = precos.visiveis();
  const imagem = p.imagens[0] ?? p.variacoes.find((v) => v.imagem)?.imagem;
  return (
    <button type="button" class="produto" onClick={() => aoAbrir(p)}>
      <div class="produto-imagem">
        <Imagem src={imagem} nome={p.nome} />
        {p.regras?.selo && <span class={classeDoSelo(p.regras.selo)}>{p.regras.selo}</span>}
      </div>
      <div class="produto-info">
        <span class="produto-nome">{p.nome}</span>
        <span class="produto-m2">{m2 && comPreco ? `${brl(f.valor / m2)} o m²` : `Vendido por ${unidade(p.unidade, 1)}`}</span>
        <div class="preco">
          {comPreco && f.de > 0 && <div class="preco-de">{brl(f.de)}</div>}
          {comPreco ? (
            <div class="preco-por">
              {f.aPartir && <small>a partir de </small>}
              {brl(f.valor)} <small>/{unidade(p.unidade, 1)}</small>
            </div>
          ) : (
            <div class="sob-consulta">Preço sob consulta</div>
          )}
          {!produtoVendavel(p) && <div class="esgotado">Indisponível no momento</div>}
          {quantidade > 0 && <div class="no-carrinho">✓ {quantidade} no carrinho</div>}
        </div>
      </div>
    </button>
  );
}

/** Rolagem infinita: carrega a próxima página ao chegar perto do fim (com botão de reserva). */
function Sentinela({ carregando, aoVer }: { carregando: boolean; aoVer: () => void }) {
  const alvo = useRef<HTMLDivElement>(null);
  const ultimo = useRef(aoVer);
  ultimo.current = aoVer;
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !alvo.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && ultimo.current(), { rootMargin: '400px' });
    io.observe(alvo.current);
    return () => io.disconnect();
  }, []);
  return (
    <div class="mais" ref={alvo}>
      <button type="button" class="botao" disabled={carregando} onClick={aoVer}>
        {carregando ? 'Carregando…' : 'Ver mais produtos'}
      </button>
    </div>
  );
}
