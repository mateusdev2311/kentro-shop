import type { Tema } from './tipos';

// Aparência escolhida pelo lojista: letras, cantos e proporção da foto viram variáveis CSS na raiz.

interface Fontes {
  titulo: string;
  texto: string;
  /** Folha do Google Fonts; ausente = já carregada no index.html ou fontes do sistema. */
  css?: string;
}

const SISTEMA = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIFA = 'Georgia, "Times New Roman", serif';
const GOOGLE = 'https://fonts.googleapis.com/css2?';

export const FONTES: Record<NonNullable<Tema['fonte']>, Fontes> = {
  classica: { titulo: `"Fraunces", ${SERIFA}`, texto: `"Instrument Sans", ${SISTEMA}` },
  moderna: { titulo: `"Sora", ${SISTEMA}`, texto: `"Manrope", ${SISTEMA}`, css: `${GOOGLE}family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap` },
  elegante: {
    titulo: `"Playfair Display", ${SERIFA}`,
    texto: `"Lato", ${SISTEMA}`,
    css: `${GOOGLE}family=Playfair+Display:wght@500;600;700&family=Lato:wght@400;700&display=swap`,
  },
  arredondada: { titulo: `"Nunito", ${SISTEMA}`, texto: `"Nunito", ${SISTEMA}`, css: `${GOOGLE}family=Nunito:wght@400;500;600;700;800&display=swap` },
  forte: {
    titulo: `"Oswald", "Arial Narrow", ${SISTEMA}`,
    texto: `"Source Sans 3", ${SISTEMA}`,
    css: `${GOOGLE}family=Oswald:wght@500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap`,
  },
  simples: { titulo: SISTEMA, texto: SISTEMA },
};

const CANTOS: Record<NonNullable<Tema['cantos']>, string> = { arredondados: '1', suaves: '.5', retos: '0' };
const PROPORCAO: Record<NonNullable<Tema['imagemProduto']>, string> = { quadrada: '1', retrato: '3 / 4' };

export function aplicarAparencia(tema: Tema, doc: Document = document): void {
  const raiz = doc.documentElement.style;
  const fonte = tema.fonte && FONTES[tema.fonte] ? tema.fonte : 'classica';
  const fontes = FONTES[fonte];
  raiz.setProperty('--fonte-titulo', fontes.titulo);
  raiz.setProperty('--fonte', fontes.texto);
  raiz.setProperty('--canto', CANTOS[tema.cantos ?? 'arredondados'] ?? '1');
  raiz.setProperty('--proporcao-produto', PROPORCAO[tema.imagemProduto ?? 'quadrada'] ?? '1');
  if (fontes.css && !doc.querySelector(`link[data-fonte="${fonte}"]`)) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontes.css;
    link.dataset.fonte = fonte;
    doc.head.appendChild(link);
  }
}
