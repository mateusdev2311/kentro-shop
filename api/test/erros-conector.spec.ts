import {
  CredencialInvalida,
  LimiteDaPlataforma,
  NaoEncontrado,
  PlataformaIndisponivel,
  RecusadoPelaPlataforma,
  SemIntegracao,
  traduzirErroConector,
} from '../src/conectores/nucleo/erros';

describe('traduzirErroConector', () => {
  it.each([
    [new CredencialInvalida(), 422, 'CREDENCIAL_INVALIDA'],
    [new LimiteDaPlataforma(), 503, 'LIMITE_DA_PLATAFORMA'],
    [new PlataformaIndisponivel(), 502, 'PLATAFORMA_INDISPONIVEL'],
    [new NaoEncontrado(), 404, 'NAO_ENCONTRADO'],
    [new RecusadoPelaPlataforma('Estoque insuficiente'), 422, 'RECUSADO_PELA_PLATAFORMA'],
    [new SemIntegracao(), 409, 'SEM_INTEGRACAO'],
    [new Error('x'), 500, 'ERRO_INTERNO'],
  ])('%p → %i %s', (erro, status, codigo) => {
    const traduzido = traduzirErroConector(erro);
    expect(traduzido.getStatus()).toBe(status);
    expect(traduzido.codigo).toBe(codigo);
  });

  it('repassa a mensagem da plataforma', () => {
    expect(traduzirErroConector(new RecusadoPelaPlataforma('Estoque insuficiente')).mensagem).toBe('Estoque insuficiente');
  });

  it('explica como resolver a falta de integração', () => {
    expect(traduzirErroConector(new SemIntegracao()).mensagem).toBe(
      'Esta loja ainda não conectou o e-commerce. Configure em Kentro Shop > Integração.',
    );
  });
});
