import { brl } from '../formato';
import { precos } from '../precos';
import type { PagamentoNaEntrega, Sessao } from '../tipos';

const FORMAS: Record<PagamentoNaEntrega['forma'], string> = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' };

/** "Dinheiro na entrega (troco para R$ 100,00)". */
function textoDoPagamento(p: PagamentoNaEntrega, tipo: 'entrega' | 'retirada'): string {
  return `${FORMAS[p.forma]} na ${tipo}${p.trocoPara ? ` (troco para ${brl(p.trocoPara)})` : ''}`;
}

export function Confirmado({ sessao }: { sessao: Sessao }) {
  const c = sessao.checkout;
  const comPreco = precos.visiveis();
  const destino =
    c?.tipo === 'entrega'
      ? `${c.entrega.rua}, ${c.entrega.numero} — ${c.entrega.bairro}, ${c.entrega.cidade}/${c.entrega.estado}`
      : c?.tipo === 'retirada'
        ? `${c.loja.nome} — ${c.loja.endereco}`
        : '';
  const frete = sessao.totais.frete;
  // Pedido criado na loja: falta só o pagamento, no checkout da própria loja.
  const pagar = sessao.pedido?.url;
  // Pedido que entrou direto no sistema da loja, pago ao receber.
  const naLoja = !pagar && sessao.pedido ? sessao.pedido.numero : '';
  return (
    <div class="carrinho confirmado">
      <div class="selo-ok" aria-hidden="true">
        ✓
      </div>
      <h2 id="carrinho-titulo">
        {pagar ? `Pedido nº ${sessao.pedido!.numero} criado!` : naLoja ? `Pedido nº ${naLoja} recebido pela loja!` : comPreco ? 'Pedido enviado!' : 'Pedido de orçamento enviado!'}
      </h2>
      <p>
        {pagar
          ? 'Falta só o pagamento. Ele é feito no site da loja, com segurança; o atendente acompanha tudo pelo WhatsApp.'
          : naLoja
            ? 'A loja já recebeu seu pedido e vai separar os produtos. O atendente acompanha tudo pelo WhatsApp.'
            : comPreco
            ? 'Recebemos seu pedido. Um atendente vai conferir estoque, prazo e pagamento e confirmar tudo com você no WhatsApp.'
            : 'Recebemos sua lista. Um atendente vai preparar os valores e o frete e enviar para você no WhatsApp.'}
      </p>
      {pagar && (
        <a class="botao primario largo pagar" href={pagar} target="_blank" rel="noopener">
          Pagar o pedido
        </a>
      )}
      <div class="resumo-lista">
        {sessao.itens.map((i) => (
          <div key={`${i.produtoId}|${i.variacaoId ?? ''}`}>
            <span>
              {i.quantidade}× {i.nome}
              {i.variacaoNome ? ` (${i.variacaoNome})` : ''}
            </span>
            {comPreco && <span>{brl(i.subtotal)}</span>}
          </div>
        ))}
        {comPreco && c?.tipo === 'entrega' && (
          <div>
            <span>Entrega</span>
            <span>{frete === null ? 'a combinar' : frete === 0 ? 'Grátis' : brl(frete)}</span>
          </div>
        )}
        {comPreco && (
          <div>
            <span>
              <strong>Total</strong>
            </span>
            <span>
              <strong>{brl(sessao.totais.total)}</strong>
            </span>
          </div>
        )}
        {destino && (
          <div>
            <span>{c?.tipo === 'entrega' ? 'Entregar em' : 'Retirar em'}</span>
            <span style={{ textAlign: 'right' }}>{destino}</span>
          </div>
        )}
        {c?.pagamento && (
          <div>
            <span>Pagamento</span>
            <span style={{ textAlign: 'right' }}>{textoDoPagamento(c.pagamento, c.tipo)}</span>
          </div>
        )}
      </div>
      <p style={{ marginTop: '16px' }}>Você já pode voltar para a conversa no WhatsApp.</p>
    </div>
  );
}
