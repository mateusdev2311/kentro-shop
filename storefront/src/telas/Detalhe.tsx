import { useEffect, useState } from 'preact/hooks';
import type { Api } from '../api';
import type { Carrinho } from '../carrinho';
import { adicionado, brl, caixasParaArea, num, quantidadeSugerida, unidade } from '../formato';
import { precos } from '../precos';
import type { Produto, Variacao } from '../tipos';
import { Imagem, primeiraVariacao, produtoVendavel, vendavel } from './comum';

interface Props {
  produto: Produto;
  api: Pick<Api, 'produto'>;
  carrinho: Carrinho;
  aviso: (texto: string, erro?: boolean) => void;
}

const MAX = 999;
const limitar = (q: number) => Math.max(1, Math.min(MAX, Math.floor(q) || 1));

interface Sugestao {
  produto: Produto;
  variacao: Variacao | null;
}

export function Detalhe({ produto, api, carrinho, aviso }: Props) {
  const [variacao, setVariacao] = useState<Variacao | null>(() => primeiraVariacao(produto));
  const [quantidade, setQuantidade] = useState(1);
  const [area, setArea] = useState('');
  const [perda, setPerda] = useState(true);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);

  // "Compre junto": até 4 SKUs, carregados ao vivo (preço e estoque atuais).
  useEffect(() => {
    let vivo = true;
    const skus = (produto.regras?.compreJunto ?? []).filter((s) => s && s !== produto.sku).slice(0, 4);
    if (!skus.length) return;
    void Promise.all(skus.map((sku) => api.produto(sku).catch(() => null))).then((lista) => {
      if (!vivo) return;
      setSugestoes(lista.filter((p): p is Produto => !!p && produtoVendavel(p)).map((p) => ({ produto: p, variacao: primeiraVariacao(p) })));
    });
    return () => {
      vivo = false;
    };
  }, [produto.id]);

  const fonte = variacao ?? produto;
  const podeComprar = vendavel(fonte);
  const m2PorUnidade = produto.regras?.m2PorUnidade ?? 0;
  const m2Total = m2PorUnidade ? quantidade * m2PorUnidade : 0;
  const deAntes = fonte.precoDe && fonte.precoDe > fonte.preco ? fonte.precoDe : 0;
  const jaNoCarrinho = carrinho.quantidade(produto.id, variacao?.id);
  const imagem = variacao?.imagem ?? produto.imagens[0];
  const comPreco = precos.visiveis();

  function calcular(novaArea: string, comPerda: boolean) {
    setArea(novaArea);
    setPerda(comPerda);
    const caixas = caixasParaArea(Number.parseFloat(novaArea.replace(',', '.')), m2PorUnidade, comPerda);
    if (caixas > 0) setQuantidade(limitar(caixas));
  }

  function adicionar() {
    if (!podeComprar) return;
    carrinho.alterar(produto.id, variacao?.id ?? null, jaNoCarrinho + quantidade);
    aviso(`${quantidade} ${unidade(produto.unidade, quantidade)} ${adicionado(produto.unidade, quantidade)} ao carrinho`);
  }

  function adicionarSugestao(s: Sugestao) {
    const q = quantidadeSugerida(m2Total, s.produto.regras?.rendimentoM2);
    const atual = carrinho.quantidade(s.produto.id, s.variacao?.id);
    carrinho.alterar(s.produto.id, s.variacao?.id ?? null, atual + q);
    aviso(`${q} ${unidade(s.produto.unidade, q)} de ${s.produto.nome} no carrinho`);
  }

  return (
    <>
      <div class="detalhe">
        <div class="detalhe-imagem">
          <Imagem src={imagem} nome={produto.nome} carregarDepois={false} />
        </div>
        <div>
          <span class="sku">Cód. {fonte.sku}</span>
          <h2 id="produto-nome">{produto.nome}</h2>
          {comPreco ? (
            <div class="preco">
              {deAntes > 0 && <div class="preco-de">{brl(deAntes)}</div>}
              <div class="preco-por">
                {brl(fonte.preco)}{' '}
                <small>
                  /{unidade(produto.unidade, 1)}
                  {m2PorUnidade ? ` · ${brl(fonte.preco / m2PorUnidade)}/m²` : ''}
                </small>
              </div>
            </div>
          ) : (
            <div class="sob-consulta">Preço sob consulta · vendido por {unidade(produto.unidade, 1)}</div>
          )}
          <Estoque disponivel={podeComprar} estoque={fonte.estoque} unidadeSigla={produto.unidade} />
          {produto.descricao && <p class="descricao">{produto.descricao}</p>}

          {produto.variacoes.length > 0 && (
            <>
              <label class="campo">
                {produto.atributosVariacao?.join(' / ') || 'Opção'}: {variacao?.nome}
              </label>
              <div class="variacoes" role="group" aria-label="Opções">
                {produto.variacoes.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    class={`variacao${v.id === variacao?.id ? ' ativa' : ''}${v.cores?.length ? '' : ' sem-amostra'}`}
                    aria-pressed={v.id === variacao?.id}
                    disabled={!vendavel(v)}
                    onClick={() => setVariacao(v)}
                  >
                    {v.cores?.length ? <span class="amostra" style={{ background: `linear-gradient(135deg, ${v.cores[0]}, ${v.cores[1] ?? v.cores[0]})` }} /> : null}
                    {v.nome}
                  </button>
                ))}
              </div>
            </>
          )}

          {m2PorUnidade > 0 && (
            <div class="calculadora">
              <strong>Quantas {unidade(produto.unidade, 2)} eu preciso?</strong>
              <div class="linha">
                <input
                  class="entrada"
                  type="text"
                  inputMode="decimal"
                  placeholder="Área em m²"
                  aria-label="Área em m²"
                  value={area}
                  onInput={(e) => calcular(e.currentTarget.value, perda)}
                />
                <label>
                  <input type="checkbox" checked={perda} onChange={(e) => calcular(area, e.currentTarget.checked)} /> +10% de perda
                </label>
              </div>
              <small>
                {quantidade} {unidade(produto.unidade, quantidade)} cobrem {num(m2Total)} m².
              </small>
            </div>
          )}

          <div class="comprar">
            <div class="quantidade">
              <button type="button" aria-label="Diminuir" onClick={() => setQuantidade((q) => limitar(q - 1))}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX}
                aria-label="Quantidade"
                value={quantidade}
                onChange={(e) => setQuantidade(limitar(Number(e.currentTarget.value)))}
              />
              <button type="button" aria-label="Aumentar" onClick={() => setQuantidade((q) => limitar(q + 1))}>
                +
              </button>
            </div>
            <button type="button" class="botao primario" disabled={!podeComprar} onClick={adicionar}>
              {podeComprar ? 'Adicionar' : 'Indisponível'}
            </button>
          </div>
          {comPreco && (
            <div class="total-linha">
              {quantidade} {unidade(produto.unidade, quantidade)} = <strong>{brl(fonte.preco * quantidade)}</strong>
            </div>
          )}
          {jaNoCarrinho > 0 && (
            <div class="total-linha">
              Você já tem{' '}
              <strong>
                {jaNoCarrinho} {unidade(produto.unidade, jaNoCarrinho)}
              </strong>{' '}
              deste item no carrinho.
            </div>
          )}
        </div>
      </div>

      {sugestoes.length > 0 && (
        <div class="compre-junto">
          <h3>Compre junto</h3>
          <p>O que normalmente vai junto com este produto.</p>
          {sugestoes.map((s, i) => {
            const q = quantidadeSugerida(m2Total, s.produto.regras?.rendimentoM2);
            const preco = (s.variacao ?? s.produto).preco;
            const porMetragem = m2Total > 0 && !!s.produto.regras?.rendimentoM2;
            return (
              <div class="sugestao" key={s.produto.id}>
                <div class="miniatura">
                  <Imagem src={s.variacao?.imagem ?? s.produto.imagens[0]} nome={s.produto.nome} />
                </div>
                <div class="texto">
                  <strong>{s.produto.nome}</strong>
                  <small>
                    {porMetragem ? `Para ${num(m2Total)} m²: ` : 'Sugestão: '}
                    {q} {unidade(s.produto.unidade, q)}
                  </small>
                  {s.produto.variacoes.length > 0 && (
                    <select
                      class="entrada"
                      aria-label={`Opção de ${s.produto.nome}`}
                      value={s.variacao?.id}
                      onChange={(e) => {
                        const id = e.currentTarget.value;
                        setSugestoes((lista) => lista.map((x, j) => (j === i ? { ...x, variacao: x.produto.variacoes.find((v) => v.id === id) ?? null } : x)));
                      }}
                    >
                      {s.produto.variacoes.filter(vendavel).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nome}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <button type="button" class="botao" aria-label={`Adicionar ${s.produto.nome}`} onClick={() => adicionarSugestao(s)}>
                  {comPreco ? `+ ${brl(preco)}` : '+ Adicionar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Estoque({ disponivel, estoque, unidadeSigla }: { disponivel: boolean; estoque: number | null; unidadeSigla: string }) {
  if (!disponivel) return <div class="estoque fora">Indisponível no momento</div>;
  if (estoque !== null && estoque <= 10) {
    return (
      <div class="estoque baixo">
        Últimas {estoque} {unidade(unidadeSigla, estoque)}
      </div>
    );
  }
  return <div class="estoque">Em estoque</div>;
}
