import { render } from 'preact';

// Fase 0: só a tela de link indisponível (spec, seção 9). O catálogo entra na Fase 1.
function LinkIndisponivel() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '48px 16px', textAlign: 'center', color: '#1e1e1e' }}>
      <p style={{ fontSize: '18px' }}>Este link não está mais disponível. Peça um novo link no WhatsApp.</p>
    </main>
  );
}

render(<LinkIndisponivel />, document.getElementById('app')!);
