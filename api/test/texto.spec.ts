import { htmlParaTexto, numero, urlHttps } from '../src/conectores/nucleo/texto';

describe('htmlParaTexto', () => {
  it('remove tags, scripts e decodifica entidades', () => {
    expect(htmlParaTexto('<p>Piso <b>forte</b></p><p>2&nbsp;m&sup2;&amp;</p><script>x()</script>')).toBe('Piso forte\n2 m²&');
  });

  it('decodifica entidades numéricas e aspas', () => {
    expect(htmlParaTexto('Caixa &#8211; 4 pe&ccedil;as &quot;A&quot; &#39;B&#39;')).toBe('Caixa – 4 peças "A" \'B\'');
  });

  it('troca <br> por quebra de linha e colapsa espaços', () => {
    expect(htmlParaTexto('linha 1<br/>   linha    2<style>.x{}</style>')).toBe('linha 1\nlinha 2');
  });

  it('vazio ou nulo vira texto vazio', () => {
    expect(htmlParaTexto(null)).toBe('');
    expect(htmlParaTexto(undefined)).toBe('');
  });
});

describe('numero', () => {
  it('aceita número e texto com ponto ou vírgula', () => {
    expect(numero(7)).toBe(7);
    expect(numero('129.90')).toBe(129.9);
    expect(numero('1.234,50')).toBe(1234.5);
    expect(numero('129,90')).toBe(129.9);
  });

  it('vazio, nulo ou inválido vira null', () => {
    expect(numero('')).toBeNull();
    expect(numero(null)).toBeNull();
    expect(numero(undefined)).toBeNull();
    expect(numero('abc')).toBeNull();
  });
});

describe('urlHttps', () => {
  it('garante URL absoluta https', () => {
    expect(urlHttps('loja.com/a.jpg')).toBe('https://loja.com/a.jpg');
    expect(urlHttps('http://x/y')).toBe('https://x/y');
    expect(urlHttps('https://x/y')).toBe('https://x/y');
    expect(urlHttps('//cdn.x/y.png')).toBe('https://cdn.x/y.png');
  });

  it('vazio vira null', () => {
    expect(urlHttps('')).toBeNull();
    expect(urlHttps(null)).toBeNull();
  });
});
