export const MENSAGEM_LINK_INVALIDO = 'Este link não está mais disponível. Peça um novo link no WhatsApp.';

export function LinkInvalido({ mensagem = MENSAGEM_LINK_INVALIDO, aoTentarDeNovo }: { mensagem?: string; aoTentarDeNovo?: () => void }) {
  return (
    <main class="tela-cheia">
      <h1>{aoTentarDeNovo ? 'Não foi possível abrir' : 'Link indisponível'}</h1>
      <p>{mensagem}</p>
      {aoTentarDeNovo && (
        <button type="button" class="botao primario" onClick={aoTentarDeNovo}>
          Tentar de novo
        </button>
      )}
    </main>
  );
}
