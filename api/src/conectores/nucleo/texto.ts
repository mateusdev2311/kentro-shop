// Normalização dos dados que chegam das plataformas: HTML, números como texto e URLs sem esquema.

const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  sup1: '¹', sup2: '²', sup3: '³', deg: '°', ordm: 'º', ordf: 'ª',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bull: '•', middot: '·',
  reg: '®', copy: '©', trade: '™', times: '×', frac12: '½', frac14: '¼',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', Agrave: 'À', acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ', ccedil: 'ç', Ccedil: 'Ç', uuml: 'ü', Uuml: 'Ü',
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (inteira, nome: string) => {
    if (nome[0] === '#') {
      const codigo = nome[1].toLowerCase() === 'x' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[nome] ?? inteira;
  });
}

/** Converte a descrição HTML da plataforma em texto puro, seguro para exibir. */
export function htmlParaTexto(html: string | null | undefined): string {
  if (!html) return '';
  const semBlocos = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  const comQuebras = semBlocos.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  const semTags = comQuebras.replace(/<[^>]*>/g, '');
  return decodificarEntidades(semTags)
    .split('\n')
    .map((linha) => linha.replace(/[ \t ]+/g, ' ').trim())
    .filter((linha) => linha.length > 0)
    .join('\n');
}

/** Número a partir de número ou texto ("129.90", "1.234,50"); vazio ou inválido vira null. */
export function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let texto = v.trim();
  if (!texto) return null;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/** URL absoluta https (a Kentro roda em HTTPS e bloqueia imagens HTTP). */
export function urlHttps(v: string | null | undefined): string | null {
  const url = (v ?? '').trim();
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'https://');
  if (/^https:\/\//i.test(url)) return url;
  return `https://${url}`;
}
