// Imagens dos produtos de exemplo, desenhadas em SVG na hora (nada de foto de marca real nem arquivo para manter).
// Cada produto da demo declara um `visual`: a forma da embalagem (ou a textura, nos revestimentos), as cores e o
// texto do rótulo. As formas são desenhadas num quadro de 800×800, com o produto centrado.

export type Forma =
  | 'caixa'
  | 'frasco'
  | 'tubo'
  | 'pote'
  | 'saco'
  | 'sache'
  | 'lata'
  | 'garrafa'
  | 'caixinha'
  | 'pacote'
  | 'bola'
  | 'tigela'
  | 'coleira'
  | 'banana'
  | 'maca'
  | 'balde'
  | 'rolo'
  | 'rodape'
  | 'textura';

export type Padrao =
  | 'marmore'
  | 'cimento'
  | 'madeira'
  | 'travertino'
  | 'liso'
  | 'antiderrapante'
  | 'subway'
  | 'ondas'
  | 'hexagono';

export interface Visual {
  forma: Forma;
  /** Cor principal da embalagem (ou a base da textura). */
  cor: string;
  /** Cor de destaque (tampa, faixa, detalhe). */
  cor2?: string;
  /** Texto grande do rótulo, curto (ex.: "Dipirona"). */
  rotulo?: string;
  /** Segunda linha do rótulo (ex.: "500 mg · 10 comp."). */
  detalhe?: string;
  /** Só para forma "textura". */
  padrao?: Padrao;
}

const FONTE = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif";

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escurece (fator < 1) ou clareia (fator > 1) uma cor #rrggbb. */
export function tom(cor: string, fator: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(cor.trim());
  if (!m) return cor;
  const n = Number.parseInt(m[1], 16);
  const canal = (v: number) => {
    const c = fator <= 1 ? v * fator : v + (255 - v) * (fator - 1);
    return Math.max(0, Math.min(255, Math.round(c)));
  };
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(canal);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function luminancia(cor: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(cor.trim());
  if (!m) return 0.5;
  const n = Number.parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Cor do nome no rótulo: um tom escuro da embalagem; em embalagem clara, a cor de destaque (ou grafite). */
function corDoNome(v: Visual): string {
  if (luminancia(v.cor) < 0.72) return tom(v.cor, 0.55);
  return v.cor2 && luminancia(v.cor2) < 0.6 ? v.cor2 : '#2b2b2b';
}

/** Texto centrado que encolhe para caber na largura. */
function texto(x: number, y: number, conteudo: string | undefined, tamanho: number, cor: string, largura: number, peso = 700): string {
  if (!conteudo) return '';
  const t = Math.min(tamanho, largura / (conteudo.length * 0.58));
  return `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${t.toFixed(1)}" font-weight="${peso}" fill="${cor}" text-anchor="middle" dominant-baseline="middle">${esc(conteudo)}</text>`;
}

/** Rótulo branco com o nome e o detalhe. */
function rotulo(v: Visual, x: number, y: number, l: number, a: number, raio = 14): string {
  const meio = x + l / 2;
  return (
    `<rect x="${x}" y="${y}" width="${l}" height="${a}" rx="${raio}" fill="#fff" opacity=".96"/>` +
    texto(meio, y + a * (v.detalhe ? 0.4 : 0.5), v.rotulo, Math.min(52, a * 0.34), corDoNome(v), l - 28, 800) +
    texto(meio, y + a * 0.72, v.detalhe, Math.min(30, a * 0.2), '#4a4a4a', l - 28, 600)
  );
}

const sombra = (cx: number, cy: number, rx: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.12}" fill="#000" opacity=".12"/>`;

function brilho(x: number, y: number, l: number, a: number): string {
  return `<rect x="${x}" y="${y}" width="${l}" height="${a}" rx="${Math.min(l, a) / 2}" fill="#fff" opacity=".22"/>`;
}

function caixa(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.75);
  return (
    sombra(415, 640, 230) +
    `<polygon points="230,240 280,195 620,195 570,240" fill="${tom(c, 1.25)}"/>` +
    `<polygon points="570,240 620,195 620,585 570,630" fill="${tom(c, 0.7)}"/>` +
    `<rect x="230" y="240" width="340" height="390" fill="#fbfbfa"/>` +
    `<rect x="230" y="240" width="340" height="120" fill="${c}"/>` +
    texto(400, 300, v.rotulo, 54, luminancia(c) < 0.72 ? '#fff' : '#2b2b2b', 300, 800) +
    texto(400, 430, v.detalhe, 34, corDoNome(v), 300, 700) +
    `<rect x="230" y="560" width="340" height="70" fill="${c2}"/>` +
    `<circle cx="300" cy="595" r="18" fill="#fff" opacity=".85"/><rect x="330" y="588" width="200" height="14" rx="7" fill="#fff" opacity=".6"/>` +
    `<rect x="270" y="480" width="260" height="10" rx="5" fill="${tom(c, 1.6)}"/><rect x="300" y="505" width="200" height="10" rx="5" fill="${tom(c, 1.6)}"/>`
  );
}

function frasco(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.6);
  return (
    sombra(400, 655, 170) +
    `<rect x="345" y="150" width="110" height="80" rx="14" fill="${c2}"/>` +
    `<rect x="362" y="226" width="76" height="44" fill="${tom(c, 0.85)}"/>` +
    `<rect x="265" y="262" width="270" height="392" rx="52" fill="${c}"/>` +
    brilho(285, 300, 26, 300) +
    rotulo(v, 290, 380, 220, 180)
  );
}

function tubo(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.6);
  return (
    sombra(400, 668, 150) +
    `<rect x="300" y="130" width="200" height="34" rx="6" fill="${tom(c, 0.8)}"/>` +
    `<path d="M300,160 L500,160 L470,575 Q400,600 330,575 Z" fill="${c}"/>` +
    `<rect x="352" y="580" width="96" height="80" rx="14" fill="${c2}"/>` +
    brilho(318, 190, 18, 300) +
    rotulo(v, 322, 290, 156, 190, 12)
  );
}

function pote(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.6);
  return (
    sombra(400, 650, 175) +
    `<rect x="245" y="210" width="310" height="80" rx="18" fill="${c2}"/>` +
    `<rect x="245" y="270" width="310" height="10" fill="${tom(c2, 0.8)}"/>` +
    `<rect x="255" y="285" width="290" height="360" rx="40" fill="${c}"/>` +
    brilho(275, 310, 22, 280) +
    rotulo(v, 285, 370, 230, 190)
  );
}

/** Borda serrilhada de x1 até x2 (em qualquer sentido); dir 1 = dentes para cima, -1 = para baixo. */
function zigue(x1: number, x2: number, y: number, dente: number, dir: 1 | -1): string {
  let d = '';
  const passos = Math.max(1, Math.round(Math.abs(x2 - x1) / dente));
  const passo = (x2 - x1) / passos;
  for (let i = 0; i < passos; i++) d += ` L${(x1 + (i + 0.5) * passo).toFixed(1)},${y - dir * dente * 0.6} L${(x1 + (i + 1) * passo).toFixed(1)},${y}`;
  return d;
}

function saco(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.7);
  return (
    sombra(400, 650, 200) +
    `<path d="M235,215${zigue(235, 565, 215, 22, 1)} L585,635 Q400,665 215,635 Z" fill="${c}"/>` +
    `<rect x="240" y="240" width="320" height="34" fill="${c2}" opacity=".9"/>` +
    brilho(250, 300, 22, 260) +
    rotulo(v, 275, 330, 250, 200) +
    `<circle cx="400" cy="585" r="22" fill="${c2}"/>`
  );
}

function sache(v: Visual): string {
  const c = v.cor;
  return (
    sombra(400, 640, 140) +
    `<path d="M285,250${zigue(285, 515, 250, 23, 1)} L515,610${zigue(515, 285, 610, 23, -1)} Z" fill="${c}"/>` +
    rotulo(v, 300, 340, 200, 170, 12) +
    `<rect x="300" y="540" width="200" height="22" rx="11" fill="${v.cor2 ?? tom(c, 0.7)}"/>`
  );
}

function lata(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.6);
  return (
    sombra(400, 640, 150) +
    `<rect x="285" y="245" width="230" height="380" fill="${c}"/>` +
    `<ellipse cx="400" cy="625" rx="115" ry="26" fill="${tom(c, 0.7)}"/>` +
    `<ellipse cx="400" cy="245" rx="115" ry="26" fill="${tom(c2, 1.3)}"/><ellipse cx="400" cy="245" rx="95" ry="18" fill="${c2}"/>` +
    brilho(300, 280, 18, 300) +
    rotulo(v, 300, 350, 200, 180, 8)
  );
}

function garrafa(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.6);
  return (
    sombra(400, 672, 120) +
    `<rect x="368" y="110" width="64" height="48" rx="8" fill="${c2}"/>` +
    `<path d="M374,155 L426,155 Q430,230 485,280 L485,640 Q485,665 460,665 L340,665 Q315,665 315,640 L315,280 Q370,230 374,155 Z" fill="${c}"/>` +
    brilho(332, 300, 16, 300) +
    rotulo(v, 315, 390, 170, 150, 6)
  );
}

function caixinha(v: Visual): string {
  const c = v.cor;
  return (
    sombra(410, 650, 150) +
    `<rect x="345" y="168" width="110" height="26" fill="${tom(c, 0.8)}"/>` +
    `<polygon points="290,270 510,270 455,192 345,192" fill="${tom(c, 1.15)}"/>` +
    `<polygon points="510,270 540,250 540,620 510,645" fill="${tom(c, 0.65)}"/>` +
    `<rect x="290" y="270" width="220" height="375" fill="#fbfbfa"/>` +
    `<path d="M290,520 Q400,480 510,520 L510,645 L290,645 Z" fill="${c}"/>` +
    texto(400, 345, v.rotulo, 46, corDoNome(v), 190, 800) +
    texto(400, 410, v.detalhe, 28, '#4a4a4a', 190, 600)
  );
}

function pacote(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? tom(c, 0.7);
  return (
    sombra(400, 640, 210) +
    `<rect x="215" y="240" width="370" height="390" rx="80" fill="${c}"/>` +
    `<rect x="215" y="240" width="370" height="60" rx="30" fill="${c2}" opacity=".7"/>` +
    brilho(240, 320, 24, 240) +
    rotulo(v, 270, 360, 260, 190)
  );
}

function bola(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? '#ffffff';
  return (
    sombra(400, 630, 160) +
    `<circle cx="400" cy="420" r="185" fill="${c}"/>` +
    `<path d="M240,330 Q400,420 560,330" stroke="${c2}" stroke-width="26" fill="none"/>` +
    `<path d="M240,510 Q400,420 560,510" stroke="${c2}" stroke-width="26" fill="none"/>` +
    `<circle cx="330" cy="330" r="40" fill="#fff" opacity=".25"/>`
  );
}

function tigela(v: Visual): string {
  const c = v.cor;
  return (
    sombra(400, 610, 220) +
    `<path d="M210,400 L590,400 Q570,600 400,600 Q230,600 210,400 Z" fill="${c}"/>` +
    `<ellipse cx="400" cy="400" rx="190" ry="44" fill="${tom(c, 1.3)}"/>` +
    `<ellipse cx="400" cy="404" rx="160" ry="32" fill="${v.cor2 ?? tom(c, 0.55)}"/>` +
    `<path d="M240,450 Q250,540 330,570" stroke="#fff" stroke-width="14" fill="none" opacity=".35" stroke-linecap="round"/>`
  );
}

function coleira(v: Visual): string {
  const c = v.cor;
  const c2 = v.cor2 ?? '#c9c9c9';
  return (
    sombra(400, 640, 190) +
    `<ellipse cx="400" cy="420" rx="185" ry="165" fill="none" stroke="${c}" stroke-width="58"/>` +
    `<ellipse cx="400" cy="420" rx="185" ry="165" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="14 18" opacity=".7"/>` +
    `<rect x="350" y="560" width="100" height="70" rx="12" fill="${c2}"/><rect x="372" y="578" width="56" height="34" rx="6" fill="${tom(c2, 0.7)}"/>` +
    `<circle cx="400" cy="250" r="26" fill="${c2}"/>`
  );
}

function banana(v: Visual): string {
  const c = v.cor;
  const fruta = (dx: number, dy: number, r: number) =>
    `<g transform="translate(${dx},${dy}) rotate(${r} 400 420)"><path d="M230,330 Q300,600 560,520 Q600,505 590,480 Q360,520 270,300 Q250,280 230,330 Z" fill="${c}" stroke="${tom(c, 0.75)}" stroke-width="6"/><path d="M582,478 l26,-10" stroke="#5b4a1e" stroke-width="16" stroke-linecap="round"/></g>`;
  return sombra(420, 620, 210) + fruta(0, 30, 6) + fruta(-10, 0, 0) + fruta(-20, -30, -6) + `<rect x="200" y="290" width="70" height="40" rx="14" fill="#6b5a2a" transform="rotate(-30 235 310)"/>`;
}

function maca(v: Visual): string {
  const c = v.cor;
  const uma = (x: number, y: number, s: number) =>
    `<g transform="translate(${x},${y}) scale(${s})"><path d="M0,-80 C-110,-130 -170,0 -110,90 C-70,150 -25,140 0,125 C25,140 70,150 110,90 C170,0 110,-130 0,-80 Z" fill="${c}"/><path d="M0,-80 Q8,-130 30,-150" stroke="#5b3a1e" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M10,-120 Q70,-160 95,-110 Q50,-100 10,-120 Z" fill="${v.cor2 ?? '#5c9a3c'}"/><ellipse cx="-60" cy="-20" rx="18" ry="34" fill="#fff" opacity=".3"/></g>`;
  return sombra(400, 640, 230) + uma(300, 480, 1) + uma(500, 480, 1) + uma(400, 360, 1.05);
}

function balde(v: Visual): string {
  const c = v.cor;
  return (
    sombra(400, 640, 170) +
    `<path d="M300,260 Q400,140 500,260" stroke="#777" stroke-width="10" fill="none"/>` +
    `<path d="M270,260 L530,260 L505,625 L295,625 Z" fill="${c}"/>` +
    `<ellipse cx="400" cy="260" rx="132" ry="26" fill="${v.cor2 ?? tom(c, 0.7)}"/>` +
    rotulo(v, 300, 360, 200, 180, 10)
  );
}

function rolo(v: Visual): string {
  const c = v.cor;
  return (
    sombra(400, 600, 230) +
    `<rect x="210" y="320" width="380" height="240" fill="${c}"/>` +
    `<ellipse cx="210" cy="440" rx="40" ry="120" fill="${tom(c, 0.8)}"/>` +
    `<ellipse cx="590" cy="440" rx="40" ry="120" fill="${tom(c, 1.2)}"/>` +
    `<ellipse cx="590" cy="440" rx="26" ry="80" fill="none" stroke="${tom(c, 0.75)}" stroke-width="5"/><ellipse cx="590" cy="440" rx="12" ry="38" fill="${tom(c, 0.6)}"/>` +
    rotulo(v, 280, 370, 230, 140, 10)
  );
}

function rodape(v: Visual): string {
  const c = v.cor;
  const barra = (y: number, r: number) =>
    `<g transform="rotate(${r} 400 ${y})"><rect x="140" y="${y}" width="520" height="70" rx="6" fill="${c}"/><rect x="140" y="${y}" width="520" height="16" fill="${tom(c, 0.88)}"/><rect x="140" y="${y + 58}" width="520" height="12" fill="${tom(c, 0.8)}"/></g>`;
  return sombra(400, 620, 260) + barra(300, -8) + barra(410, -8) + barra(520, -8);
}

// ── Texturas (revestimentos) ─────────────────────────────────────────────────

function textura(v: Visual, id: string): string {
  const c = v.cor;
  const base = `<rect x="80" y="80" width="640" height="640" rx="10" fill="${c}"/>`;
  const quadro = (miolo: string) =>
    `<g clip-path="url(#q${id})">${miolo}</g><rect x="80" y="80" width="640" height="640" rx="10" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="2"/>`;
  const defs = (extra = '') => `<defs><clipPath id="q${id}"><rect x="80" y="80" width="640" height="640" rx="10"/></clipPath>${extra}</defs>`;
  const ruido = (freq: string, oitavas: number, opacidade: number, cor: string) =>
    `<filter id="r${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oitavas}" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 ${canal(cor, 0)} 0 0 0 0 ${canal(cor, 1)} 0 0 0 0 ${canal(cor, 2)} 0 0 0 ${opacidade} 0"/></filter>`;
  const juntas = (n: number) => {
    let s = '';
    for (let i = 1; i < n; i++) {
      const p = 80 + (640 / n) * i;
      s += `<line x1="${p}" y1="80" x2="${p}" y2="720" stroke="#fff" stroke-opacity=".75" stroke-width="4"/><line x1="80" y1="${p}" x2="720" y2="${p}" stroke="#fff" stroke-opacity=".75" stroke-width="4"/>`;
    }
    return s;
  };

  switch (v.padrao) {
    case 'marmore': {
      const veios = [
        'M80,180 C220,240 300,140 420,260 S620,300 720,240',
        'M80,420 C180,380 260,520 380,470 S560,380 720,520',
        'M150,720 C220,600 320,640 360,560 S470,470 520,360',
        'M480,80 C470,160 560,190 540,280',
        'M80,600 C160,560 210,640 300,600',
      ];
      return (
        defs(ruido('0.012', 4, 0.18, '#7d7d7d')) +
        quadro(
          base +
            `<rect x="80" y="80" width="640" height="640" filter="url(#r${id})"/>` +
            veios.map((d, i) => `<path d="${d}" stroke="${v.cor2 ?? '#9a9a9a'}" stroke-width="${[5, 3, 4, 2, 2][i]}" fill="none" opacity=".55"/>`).join('') +
            juntas(2),
        )
      );
    }
    case 'cimento':
      return defs(ruido('0.035', 5, 0.35, tom(c, 0.55))) + quadro(base + `<rect x="80" y="80" width="640" height="640" filter="url(#r${id})"/>`);
    case 'travertino':
      return (
        defs(ruido('0.004 0.07', 4, 0.32, tom(c, 0.62))) +
        quadro(base + `<rect x="80" y="80" width="640" height="640" filter="url(#r${id})"/>` + juntas(2))
      );
    case 'liso':
      return defs(ruido('0.02', 3, 0.12, tom(c, 0.6))) + quadro(base + `<rect x="80" y="80" width="640" height="640" filter="url(#r${id})"/>` + juntas(3));
    case 'antiderrapante':
      return (
        defs(ruido('0.09', 3, 0.45, tom(c, 0.5))) +
        quadro(base + `<rect x="80" y="80" width="640" height="640" filter="url(#r${id})"/>` + juntas(2))
      );
    case 'madeira': {
      let reguas = '';
      const altura = 640 / 6;
      for (let i = 0; i < 6; i++) {
        const y = 80 + i * altura;
        const corte = 80 + ((i * 263) % 520) + 60;
        reguas +=
          `<rect x="80" y="${y}" width="640" height="${altura}" fill="${tom(c, [1, 0.92, 1.06, 0.95, 1.02, 0.9][i])}"/>` +
          `<line x1="${corte}" y1="${y}" x2="${corte}" y2="${y + altura}" stroke="${tom(c, 0.6)}" stroke-width="3"/>` +
          `<line x1="80" y1="${y}" x2="720" y2="${y}" stroke="${tom(c, 0.6)}" stroke-width="3"/>`;
      }
      return defs(ruido('0.004 0.12', 4, 0.4, tom(c, 0.5))) + quadro(reguas + `<rect x="80" y="80" width="640" height="640" filter="url(#r${id})"/>`);
    }
    case 'subway': {
      let tijolos = '';
      const a = 64;
      const l = 128;
      for (let linha = 0; linha < 10; linha++) {
        const desloca = linha % 2 ? -l / 2 : 0;
        for (let col = 0; col < 7; col++) {
          const x = 80 + desloca + col * l;
          const y = 80 + linha * a;
          tijolos += `<rect x="${x + 3}" y="${y + 3}" width="${l - 6}" height="${a - 6}" rx="6" fill="${c}"/><rect x="${x + 10}" y="${y + 9}" width="${l - 40}" height="7" rx="3.5" fill="#fff" opacity=".7"/>`;
        }
      }
      return defs() + quadro(`<rect x="80" y="80" width="640" height="640" fill="${v.cor2 ?? '#d9d9d6'}"/>` + tijolos);
    }
    case 'ondas': {
      let ondas = '';
      for (let i = 0; i < 9; i++) {
        const y = 80 + i * 80;
        ondas += `<path d="M80,${y + 40} C200,${y - 10} 300,${y + 90} 400,${y + 40} S600,${y - 10} 720,${y + 40} L720,${y + 80} L80,${y + 80} Z" fill="url(#g${id})"/>`;
      }
      return (
        defs(`<linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tom(c, 0.82)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>`) +
        quadro(base + ondas)
      );
    }
    case 'hexagono': {
      let hex = '';
      const r = 58;
      const h = Math.sqrt(3) * r;
      const cores = [c, v.cor2 ?? tom(c, 0.75), tom(c, 1.08)];
      for (let linha = -1; linha < 8; linha++) {
        for (let col = -1; col < 9; col++) {
          const cx = 80 + col * 1.5 * r;
          const cy = 80 + linha * h + (col % 2 ? h / 2 : 0);
          const pts = Array.from({ length: 6 }, (_, k) => `${(cx + (r - 3) * Math.cos((Math.PI / 3) * k)).toFixed(1)},${(cy + (r - 3) * Math.sin((Math.PI / 3) * k)).toFixed(1)}`).join(' ');
          hex += `<polygon points="${pts}" fill="${cores[Math.abs(linha * 7 + col * 3) % 3]}"/>`;
        }
      }
      return defs() + quadro(`<rect x="80" y="80" width="640" height="640" fill="#e9e7e2"/>` + hex);
    }
    default:
      return defs() + quadro(base);
  }
}

function canal(cor: string, i: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(cor);
  const n = m ? Number.parseInt(m[1], 16) : 0;
  return (((n >> (16 - i * 8)) & 255) / 255).toFixed(3);
}

const FORMAS: Record<Exclude<Forma, 'textura'>, (v: Visual) => string> = {
  caixa,
  frasco,
  tubo,
  pote,
  saco,
  sache,
  lata,
  garrafa,
  caixinha,
  pacote,
  bola,
  tigela,
  coleira,
  banana,
  maca,
  balde,
  rolo,
  rodape,
};

/** Só o desenho do produto (sem fundo), no quadro de 800×800. `id` evita colisão de ids quando há vários num SVG. */
export function desenhoDoProduto(v: Visual, id = 'p'): string {
  return v.forma === 'textura' ? textura(v, id) : FORMAS[v.forma](v);
}

/** Imagem do produto: o desenho sobre o fundo do nicho. */
export function svgDoProduto(v: Visual, fundo: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">` +
    `<rect width="800" height="800" fill="${fundo}"/>` +
    // As embalagens são desenhadas com folga; na imagem do produto, ampliadas para encher melhor o quadro.
    (v.forma === 'textura' ? desenhoDoProduto(v) : `<g transform="translate(400 410) scale(1.18) translate(-400 -410)">${desenhoDoProduto(v)}</g>`) +
    `</svg>`
  );
}

export interface BannerDemo {
  titulo: string;
  subtitulo: string;
  cor: string;
  cor2: string;
  /** Até 3 produtos desenhados no lado direito. */
  visuais: Visual[];
}

/** Banner 1200×600 (proporção 2:1 do carrossel): texto à esquerda, produtos à direita. */
export function svgDoBanner(b: BannerDemo): string {
  const posicoes = [
    { x: 640, y: 150, s: 0.5 },
    { x: 860, y: 90, s: 0.56 },
    { x: 760, y: 250, s: 0.46 },
  ];
  const produtos = b.visuais
    .slice(0, 3)
    .map((v, i) => `<g transform="translate(${posicoes[i].x},${posicoes[i].y}) scale(${posicoes[i].s})">${desenhoDoProduto(v, `b${i}`)}</g>`)
    .join('');
  const linhas = quebrar(b.titulo, 18);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200" height="600">` +
    `<defs><linearGradient id="fundo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b.cor}"/><stop offset="1" stop-color="${b.cor2}"/></linearGradient></defs>` +
    `<rect width="1200" height="600" fill="url(#fundo)"/>` +
    `<circle cx="1000" cy="300" r="300" fill="#fff" opacity=".12"/><circle cx="1080" cy="80" r="120" fill="#fff" opacity=".08"/>` +
    produtos +
    linhas
      .map((l, i) => `<text x="80" y="${210 + i * 78}" font-family="${FONTE}" font-size="66" font-weight="800" fill="#fff">${esc(l)}</text>`)
      .join('') +
    `<text x="80" y="${210 + linhas.length * 78 + 20}" font-family="${FONTE}" font-size="32" font-weight="500" fill="#fff" opacity=".92">${esc(b.subtitulo)}</text>` +
    `</svg>`
  );
}

function quebrar(t: string, max: number): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of t.split(/\s+/)) {
    if (atual && (atual + ' ' + palavra).length > max) {
      linhas.push(atual);
      atual = palavra;
    } else atual = atual ? `${atual} ${palavra}` : palavra;
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, 3);
}
