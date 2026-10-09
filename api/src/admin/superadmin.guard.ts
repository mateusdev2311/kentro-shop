import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { compararSeguro } from '../comum/cripto';
import { ErroApi } from '../comum/erros';

@Injectable()
export class SuperadminGuard implements CanActivate {
  constructor(@Inject(CONFIG_APP) private readonly config: ConfigApp) {}

  canActivate(contexto: ExecutionContext): boolean {
    const cabecalho = contexto.switchToHttp().getRequest<Request>().header('Authorization') ?? '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (!token || !compararSeguro(token, this.config.tokenSuperadmin)) {
      throw new ErroApi(401, 'NAO_AUTORIZADO', 'Token de superadmin ausente ou inválido.');
    }
    return true;
  }
}
