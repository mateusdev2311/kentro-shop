import type { Carrinho as EstadoCarrinho } from '../carrinho';
import { brl, num, unidade } from '../formato';
import { Imagem } from './comum';

interface Props {
  carrinho: EstadoCarrinho;
  aoContinuar: () => void;
  aoFechar: () => void;
}

/** Linhas do carrinho: dados (nome, preço) do servidor e quantidade da tela (otimista). */
export function linhasDoCarrinho(carrinho: EstadoCarrinho) {
  return (carrinho.sessao?.itens ?? [])
    .map((i) => ({
      ...i,
      m2PorUnidade: i.m2 && i.quantidade ? i.m2 / i.quantidade : 0,
      quantidade: carrinho.quantidade(i.produtoId, i.variacaoId),
    }))
    .filter((i) => i.quantidade > 0);
}

export function subtotalDaTela(carrinho: EstadoCarrinho): number {
  return Math.round(linhasDoCarrinho(carrinho).reduce((s, i) => s + i.precoUnitario * i.quantidade, 0) * 100) / 100;
}

export function Carrinho({ carrinho, aoContinuar, aoFechar }: Props) {
  const linhas = linhasDoCarrinho(carrinho);
  if (!linhas.length) {
    const atualizando = carrinho.pendente && carrinho.totalItens > 0;
    return (
      <div class="carrinho">
        <h2 id="carrinho-titulo">Seu carrinho</h2>
        <p class="vazio">
          {atualizando ? (
            'Atualizando o carrinho…'
          ) : (
            <>
              Seu carrinho está vazio.
              <br />
              Escolha os produtos no catálogo.
            </>
          )}
        </p>
        <button type="button" class="botao largo" onClick={aoFechar}>
          Ver produtos
        </button>
      </div>
    );
  }
  const itens = linhas.reduce((s, i) => s + i.quantidade, 0);
  const subtotal = subtotalDaTela(carrinho);
  return (
    <div class="carrinho">
      <h2 id="carrinho-titulo">Seu carrinho</h2>
      {linhas.map((i) => {
        const nome = i.variacaoNome ? `${i.nome} (${i.variacaoNome})` : i.nome;
        const m2 = i.m2PorUnidade ? ` · ${num(i.m2PorUnidade * i.quantidade)} m²` : '';
        return (
          <div class="item" key={`${i.produtoId}|${i.variacaoId ?? ''}`}>
            <div class="miniatura">
              <Imagem src={i.imagem} nome={i.nome} />
            </div>
            <div class="item-info">
              <strong>{i.nome}</strong>
              <small>
                {i.variacaoNome ? `${i.variacaoNome} · ` : ''}
                {brl(i.precoUnitario)}/{unidade(i.unidade, 1)}
                {m2}
              </small>
              <div class="item-acoes">
                <div class="quantidade pequena">
                  <button type="button" aria-label={`Diminuir ${nome}`} onClick={() => carrinho.somar(i.produtoId, i.variacaoId, -1)}>
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    aria-label={`Quantidade de ${nome}`}
                    value={i.quantidade}
                    onChange={(e) => carrinho.alterar(i.produtoId, i.variacaoId, Math.max(0, Math.floor(Number(e.currentTarget.value)) || 0))}
                  />
                  <button type="button" aria-label={`Aumentar ${nome}`} onClick={() => carrinho.somar(i.produtoId, i.variacaoId, 1)}>
                    +
                  </button>
                </div>
                <span class="item-preco">{brl(i.precoUnitario * i.quantidade)}</span>
              </div>
              <button type="button" class="remover" onClick={() => carrinho.alterar(i.produtoId, i.variacaoId, 0)}>
                Remover
              </button>
            </div>
          </div>
        );
      })}
      <div class="totais">
        <div>
          <span>
            Subtotal ({itens} {itens === 1 ? 'item' : 'itens'})
          </span>
          <span>{brl(subtotal)}</span>
        </div>
        <div>
          <span>Entrega</span>
          <span class="dica">calculada no próximo passo</span>
        </div>
        <div class="total">
          <span>Total</span>
          <span>{brl(subtotal)}</span>
        </div>
      </div>
      <button type="button" class="botao primario largo" onClick={aoContinuar}>
        Continuar
      </button>
      <p class="dica" style={{ textAlign: 'center' }}>
        Nada é cobrado agora. Um atendente confirma o pedido com você.
      </p>
    </div>
  );
}
