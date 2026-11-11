import { adicionado, brl, caixasParaArea, cep, cpf, cpfValido, iniciais, num, primeiroNome, quantidadeSugerida, telefone, unidade } from '../../../storefront/src/formato';
import { cpfValido as cpfValidoApi, formatarCpf } from '../../src/sessoes/cpf';

describe('formatos do catálogo', () => {
  it('moeda, número e unidade', () => {
    expect(brl(129.9)).toBe('R$ 129,90');
    expect(brl(1234.5)).toBe('R$ 1.234,50');
    expect(num(15.84)).toBe('15,84');
    expect(unidade('CX', 1)).toBe('caixa');
    expect(unidade('cx', 2)).toBe('caixas');
    expect(unidade('XYZ', 2)).toBe('xyz');
    expect(adicionado('CX', 2)).toBe('adicionadas');
    expect(adicionado('KIT', 1)).toBe('adicionado');
  });

  it('telefone, CEP, primeiro nome e iniciais', () => {
    expect(telefone('5538988887777')).toBe('(38) 98888-7777');
    expect(telefone('3832221111')).toBe('(38) 3222-1111');
    expect(telefone('+1 555 0100')).toBe('+1 555 0100');
    expect(cep('39400000')).toBe('39400-000');
    expect(cep('394')).toBe('394');
    expect(primeiroNome('  Ana Souza ')).toBe('Ana');
    expect(primeiroNome('')).toBe('');
    expect(iniciais('Porcelanato Bege Acetinado')).toBe('PB');
    expect(iniciais('')).toBe('?');
  });

  it('calculadora de caixas', () => {
    expect(caixasParaArea(10, 1.44, true)).toBe(8); // 11 m² / 1,44 = 7,6
    expect(caixasParaArea(10, 1.44, false)).toBe(7);
    expect(caixasParaArea(14.4, 1.44, false)).toBe(10); // sem erro de ponto flutuante
    expect(caixasParaArea(0, 1.44, true)).toBe(0);
    expect(caixasParaArea(10, 0, true)).toBe(0);
  });

  it('quantidade sugerida pelo rendimento', () => {
    expect(quantidadeSugerida(15.84, 4)).toBe(4);
    expect(quantidadeSugerida(2, 4)).toBe(1);
    expect(quantidadeSugerida(0, 4)).toBe(1);
    expect(quantidadeSugerida(10, undefined)).toBe(1);
  });
});

describe('CPF na nota', () => {
  it('máscara enquanto digita e dígitos verificadores (catálogo e API iguais)', () => {
    expect(cpf('529')).toBe('529');
    expect(cpf('5299822')).toBe('529.982.2');
    expect(cpf('52998224725999')).toBe('529.982.247-25');
    for (const valida of [cpfValido, cpfValidoApi]) {
      expect(valida('529.982.247-25')).toBe(true);
      expect(valida('52998224725')).toBe(true);
      expect(valida('529.982.247-24')).toBe(false);
      expect(valida('111.111.111-11')).toBe(false);
      expect(valida('1234567890')).toBe(false);
      expect(valida('')).toBe(false);
    }
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
  });
});
