import { brl } from '../formato';
import type { Sessao } from '../tipos';

export function Confirmado({ sessao }: { sessao: Sessao }) {
  const c = sessao.checkout;
  const destino =
    c?.tipo === 'entrega'
      ? `${c.entrega.rua}, ${c.entrega.numero} — ${c.entrega.bairro}, ${c.entrega.cidade}/${c.entrega.estado}`
      : c?.tipo === 'retirada'
        ? `${c.loja.nome} — ${c.loja.endereco}`
        : '';
  const frete = sessao.totais.frete;
  return (
    <div class="carrinho confirmado">
      <div class="selo-ok" aria-hidden="true">
        ✓
      </div>
      <h2 id="carrinho-titulo">Pedido enviado!</h2>
      <p>Recebemos seu pedido. Um atendente vai conferir estoque, prazo e pagamento e confirmar tudo com você no WhatsApp.</p>
      <div class="resumo-lista">
        {sessao.itens.map((i) => (
          <div key={`${i.produtoId}|${i.variacaoId ?? ''}`}>
            <span>
              {i.quantidade}× {i.nome}
              {i.variacaoNome ? ` (${i.variacaoNome})` : ''}
            </span>
            <span>{brl(i.subtotal)}</span>
          </div>
        ))}
        {c?.tipo === 'entrega' && (
          <div>
            <span>Entrega</span>
            <span>{frete === null ? 'a combinar' : frete === 0 ? 'Grátis' : brl(frete)}</span>
          </div>
        )}
        <div>
          <span>
            <strong>Total</strong>
          </span>
          <span>
            <strong>{brl(sessao.totais.total)}</strong>
          </span>
        </div>
        {destino && (
          <div>
            <span>{c?.tipo === 'entrega' ? 'Entregar em' : 'Retirar em'}</span>
            <span style={{ textAlign: 'right' }}>{destino}</span>
          </div>
        )}
      </div>
      <p style={{ marginTop: '16px' }}>Você já pode voltar para a conversa no WhatsApp.</p>
    </div>
  );
}
