import { randomBytes } from 'node:crypto';
import { lerConfig } from '../src/comum/config';

const chave32 = randomBytes(32).toString('base64');

function envValido(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://u:s@localhost:5432/db',
    CHAVE_MESTRA_CRIPTO: chave32,
    TOKEN_SUPERADMIN: 'super',
    URL_PUBLICA: 'https://shop.exemplo.com',
    ...extra,
  };
}

describe('lerConfig', () => {
  it('lista todas as variáveis obrigatórias ausentes de uma vez', () => {
    expect(() => lerConfig({})).toThrow(/DATABASE_URL.*CHAVE_MESTRA_CRIPTO.*TOKEN_SUPERADMIN.*URL_PUBLICA/s);
  });

  it('recusa chave mestra que não tem 32 bytes', () => {
    const env = envValido({ CHAVE_MESTRA_CRIPTO: randomBytes(16).toString('base64') });
    expect(() => lerConfig(env)).toThrow(/32 bytes/);
  });

  it('remove barras finais da URL pública', () => {
    expect(lerConfig(envValido({ URL_PUBLICA: 'https://shop.exemplo.com//' })).urlPublica).toBe('https://shop.exemplo.com');
  });

  it('usa a porta 3000 por padrão e aceita PORTA', () => {
    expect(lerConfig(envValido()).porta).toBe(3000);
    expect(lerConfig(envValido({ PORTA: '8080' })).porta).toBe(8080);
  });

  it('usa PORT, que a VPS preenche com a "porta interna"', () => {
    expect(lerConfig(envValido({ PORT: '4000' })).porta).toBe(4000);
  });

  it('decodifica a chave mestra para 32 bytes', () => {
    expect(lerConfig(envValido()).chaveMestra.length).toBe(32);
  });
});
