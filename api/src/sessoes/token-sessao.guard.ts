import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Sessao } from '@prisma/client';
import { Request } from 'express';
import { linkInvalido, SessoesService } from './sessoes.service';

export interface RequisicaoDoCliente extends Request {
  sessao: Sessao;
}

/** Rotas do catálogo do cliente: o token do link identifica a sessão e, por ela, a loja. */
@Injectable()
export class TokenSessaoGuard implements CanActivate {
  constructor(private readonly sessoes: SessoesService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoDoCliente>();
    const token = String(req.params.token ?? '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw linkInvalido();
    req.sessao = await this.sessoes.porToken(token);
    return true;
  }
}
