import { useEffect, useRef, useState } from 'preact/hooks';
import type { Banner } from '../tipos';

interface Props {
  banners: Banner[];
  /** Tempo de cada banner; a troca para quando o cliente mexe, com a aba oculta ou com "reduzir movimento". */
  segundos: number;
  aoTocar: (banner: Banner) => void;
}

const PAUSA_DEPOIS_DO_TOQUE_MS = 8000;

/** Carrossel do alto da vitrine: rolagem com encaixe (deslizar com o dedo é nativo), pontos e troca automática. */
export function Banners({ banners, segundos, aoTocar }: Props) {
  const trilho = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  const pausadoAte = useRef(0);

  const irPara = (i: number) => {
    const el = trilho.current;
    if (!el) return;
    el.scrollTo?.({ left: i * el.clientWidth, behavior: 'smooth' });
    setAtual(i);
  };

  useEffect(() => {
    if (banners.length < 2) return;
    const semMovimento = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (semMovimento) return;
    const relogio = setInterval(() => {
      if (document.hidden || Date.now() < pausadoAte.current) return;
      setAtual((i) => {
        const proximo = (i + 1) % banners.length;
        const el = trilho.current;
        el?.scrollTo?.({ left: proximo * el.clientWidth, behavior: 'smooth' });
        return proximo;
      });
    }, Math.max(3, segundos) * 1000);
    return () => clearInterval(relogio);
  }, [banners.length, segundos]);

  const aoRolar = () => {
    const el = trilho.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== atual) setAtual(i);
  };
  const pausar = () => (pausadoAte.current = Date.now() + PAUSA_DEPOIS_DO_TOQUE_MS);

  if (!banners.length) return null;
  return (
    <section class="banners" aria-roledescription="carrossel" aria-label="Destaques da loja">
      <div class="banners-trilho" ref={trilho} onScroll={aoRolar} onPointerDown={pausar} onTouchStart={pausar}>
        {banners.map((b, i) => {
          const tocavel = !!(b.categoriaId || b.busca);
          const conteudo = (
            <>
              <img src={b.url} alt={b.titulo ?? ''} loading={i === 0 ? 'eager' : 'lazy'} />
              {b.titulo && <span class="banner-titulo">{b.titulo}</span>}
            </>
          );
          return tocavel ? (
            <button type="button" class="banner" key={b.id} aria-label={b.titulo || 'Ver produtos'} onClick={() => aoTocar(b)}>
              {conteudo}
            </button>
          ) : (
            <div class="banner" key={b.id} role="group" aria-label={`${i + 1} de ${banners.length}`}>
              {conteudo}
            </div>
          );
        })}
      </div>
      {banners.length > 1 && (
        <div class="banners-pontos">
          {banners.map((b, i) => (
            <button
              type="button"
              key={b.id}
              class={i === atual ? 'ativo' : ''}
              aria-label={`Banner ${i + 1} de ${banners.length}`}
              aria-current={i === atual ? 'true' : undefined}
              onClick={() => {
                pausar();
                irPara(i);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
