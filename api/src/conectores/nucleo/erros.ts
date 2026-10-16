import { ErroApi } from '../../comum/erros';

// Erros padronizados dos conectores (spec 7.2). A API os traduz para mensagens em português.

export class ErroConector extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class CredencialInvalida extends ErroConector {
  constructor() {
    super('CREDENCIAL_INVALIDA', 'A plataforma recusou as credenciais. Confira os dados da integração.');
  }
}

export class LimiteDaPlataforma extends ErroConector {
  constructor() {
    super('LIMITE_DA_PLATAFORMA', 'A plataforma de e-commerce pediu para diminuir o ritmo. Tente de novo em instantes.');
  }
}

export class PlataformaIndisponivel extends ErroConector {
  constructor() {
    super('PLATAFORMA_INDISPONIVEL', 'A plataforma de e-commerce não respondeu. Tente de novo em instantes.');
  }
}

export class NaoEncontrado extends ErroConector {
  constructor(mensagem = 'Não encontrado na plataforma de e-commerce.') {
    super('NAO_ENCONTRADO', mensagem);
  }
}

export class RecusadoPelaPlataforma extends ErroConector {
  constructor(mensagem: string) {
    super('RECUSADO_PELA_PLATAFORMA', mensagem || 'A plataforma de e-commerce recusou a operação.');
  }
}

export class SemIntegracao extends ErroConector {
  constructor() {
    super('SEM_INTEGRACAO', 'Esta loja ainda não conectou o e-commerce. Configure em Kentro Shop > Integração.');
  }
}

const STATUS: Record<string, number> = {
  CREDENCIAL_INVALIDA: 422,
  LIMITE_DA_PLATAFORMA: 503,
  PLATAFORMA_INDISPONIVEL: 502,
  NAO_ENCONTRADO: 404,
  RECUSADO_PELA_PLATAFORMA: 422,
  SEM_INTEGRACAO: 409,
};

export function traduzirErroConector(e: unknown): ErroApi {
  if (e instanceof ErroApi) return e;
  if (e instanceof ErroConector && STATUS[e.codigo]) return new ErroApi(STATUS[e.codigo], e.codigo, e.message);
  return new ErroApi(500, 'ERRO_INTERNO', 'Erro interno. Tente de novo em instantes.');
}
