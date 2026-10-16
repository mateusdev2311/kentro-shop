import { useState } from 'preact/hooks';
import { ehErroDaApi } from '../api';
import { brl } from '../formato';
import type { Diferenca } from '../tipos';

interface Props {
  diferencas: Diferenca[];
  aoConfirmar: () => Promise<void>;
  aoVoltar: () => void;
}

/** 409 PRECOS_ALTERADOS: o carrinho do servidor já foi atualizado; o cliente confere e confirma. */
export function Diferencas({ diferencas, aoConfirmar, aoVoltar }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    setEnviando(true);
    setErro('');
    try {
      await aoConfirmar();
    } catch (e) {
      setErro(ehErroDaApi(e) ? e.mensagem : 'Não foi possível enviar. Tente de novo.');
      setEnviando(false);
    }
  }

  return (
    <div class="carrinho">
      <h2 id="carrinho-titulo">Alguns itens mudaram</h2>
      <p class="dica">Os preços ou o estoque mudaram desde que você montou o carrinho. Confira antes de enviar:</p>
      <ul class="diferencas">
        {diferencas.map((d) => (
          <li key={d.sku}>
            <strong>{d.nome}</strong>
            {d.depois === null ? (
              <span>Saiu do carrinho: não está mais disponível.</span>
            ) : (
              <>
                {d.antes.preco !== d.depois.preco && (
                  <span>
                    <span class="antes">{brl(d.antes.preco)}</span> → {brl(d.depois.preco)}{' '}
                  </span>
                )}
                {d.antes.quantidade !== d.depois.quantidade && (
                  <span>
                    Quantidade: {d.antes.quantidade} → {d.depois.quantidade}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {erro && (
        <div class="erro-form" role="alert">
          {erro}
        </div>
      )}
      <button type="button" class="botao primario largo" disabled={enviando} onClick={() => void confirmar()}>
        {enviando ? 'Enviando…' : 'Confirmar e enviar'}
      </button>
      <button type="button" class="botao largo" style={{ marginTop: '10px' }} onClick={aoVoltar}>
        Voltar ao carrinho
      </button>
    </div>
  );
}
