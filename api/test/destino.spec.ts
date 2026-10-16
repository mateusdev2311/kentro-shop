import { enderecoPublicoHttps, verificarDestino } from '../src/conectores/nucleo/destino';
import { RecusadoPelaPlataforma } from '../src/conectores/nucleo/erros';

describe('enderecoPublicoHttps (validação ao salvar)', () => {
  it.each([
    'https://lojateste.ecommercenet.com.br/api',
    'https://loja.com.br',
    'https://8.8.8.8/api',
  ])('aceita %s', (url) => {
    expect(enderecoPublicoHttps(url)).toBe(true);
  });

  it.each([
    'http://loja.com.br',
    'ftp://loja.com.br',
    'u',
    'https://localhost/api',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://10.0.0.5',
    'https://172.16.0.1',
    'https://192.168.1.10',
    'https://169.254.169.254/latest',
    'https://0.0.0.0',
    'https://[::1]',
    'https://[fc00::1]',
    'https://[fe80::1]',
    'https://servico.internal',
    'https://impressora.local',
  ])('recusa %s', (url) => {
    expect(enderecoPublicoHttps(url)).toBe(false);
  });
});

describe('verificarDestino (antes de cada chamada, com DNS)', () => {
  it('aceita host que resolve para IP público', async () => {
    await expect(verificarDestino('https://loja.com.br/api', async () => ['8.8.8.8'])).resolves.toBeUndefined();
  });

  it('recusa host público que resolve para IP privado', async () => {
    await expect(verificarDestino('https://loja.com.br/api', async () => ['8.8.8.8', '10.1.2.3'])).rejects.toEqual(
      new RecusadoPelaPlataforma('O Endereço da API precisa ser público e usar https://.'),
    );
  });

  it('recusa endereço que nem passa na validação básica', async () => {
    await expect(verificarDestino('http://loja.com.br', async () => ['8.8.8.8'])).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
  });
});
