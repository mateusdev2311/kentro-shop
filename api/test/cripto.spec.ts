import { randomBytes } from 'node:crypto';
import { cifrar, compararSeguro, decifrar, gerarSegredo, hashSegredo } from '../src/comum/cripto';

const chave = randomBytes(32);

describe('cifrar / decifrar', () => {
  it('recupera o texto original', () => {
    const { cifrado, iv } = cifrar('segredo-123', chave);
    expect(decifrar(cifrado, iv, chave)).toBe('segredo-123');
  });

  it('usa um IV diferente a cada cifragem', () => {
    expect(cifrar('igual', chave).iv.equals(cifrar('igual', chave).iv)).toBe(false);
  });

  it('recusa conteúdo adulterado', () => {
    const { cifrado, iv } = cifrar('segredo-123', chave);
    cifrado[0] ^= 0xff;
    expect(() => decifrar(cifrado, iv, chave)).toThrow();
  });

  it('recusa decifrar com outra chave', () => {
    const { cifrado, iv } = cifrar('segredo-123', chave);
    expect(() => decifrar(cifrado, iv, randomBytes(32))).toThrow();
  });
});

describe('gerarSegredo', () => {
  it.each([
    ['admin', /^ksa_[A-Za-z0-9_-]{43}$/],
    ['atendimento', /^ksk_[A-Za-z0-9_-]{43}$/],
    ['mcp', /^ksm_[A-Za-z0-9_-]{43}$/],
  ] as const)('gera segredo de %s com prefixo e 32 bytes', (tipo, formato) => {
    expect(gerarSegredo(tipo)).toMatch(formato);
  });

  it('nunca repete', () => {
    expect(gerarSegredo('admin')).not.toBe(gerarSegredo('admin'));
  });
});

describe('hashSegredo', () => {
  it('ignora espaços e quebras de linha nas pontas', () => {
    expect(hashSegredo(' x \n')).toBe(hashSegredo('x'));
  });

  it('é SHA-256 em hexadecimal', () => {
    expect(hashSegredo('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('compararSeguro', () => {
  it('compara textos de qualquer tamanho', () => {
    expect(compararSeguro('abc', 'abc')).toBe(true);
    expect(compararSeguro('abc', 'abd')).toBe(false);
    expect(compararSeguro('abc', 'abcd')).toBe(false);
  });
});
