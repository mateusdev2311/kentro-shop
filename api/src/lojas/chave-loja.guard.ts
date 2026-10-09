import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Loja } from '@prisma/client';
import { Request } from 'express';
import { ErroApi } from '../comum/erros';
import { LojasService, Papel as TipoPapel } from './lojas.service';

const CHAVE_PAPEL = 'papelExigido';

/** Papel mínimo da rota. A chave admin satisfaz as duas. */
export const Papel = (papel: TipoPapel) => SetMetadata(CHAVE_PAPEL, papel);

export interface RequisicaoDaLoja extends Request {
  loja: Loja;
  papel: TipoPapel;
}

@Injectable()
export class ChaveLojaGuard implements CanActivate {
  constructor(
    private readonly lojas: LojasService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoDaLoja>();
    const chave = req.header('X-Loja-Chave')?.trim();
    const encontrada = chave ? await this.lojas.buscarPorChave(chave) : null;
    if (!encontrada) {
      throw new ErroApi(401, 'CHAVE_INVALIDA', 'Chave do Kentro Shop inválida. Confira a configuração da extensão.');
    }
    if (encontrada.loja.status === 'bloqueada') {
      throw new ErroApi(403, 'LOJA_BLOQUEADA', 'Esta loja está bloqueada no Kentro Shop. Fale com o suporte.');
    }
    const exigido = this.reflector.getAllAndOverride<TipoPapel>(CHAVE_PAPEL, [contexto.getHandler(), contexto.getClass()]);
    if (exigido === 'admin' && encontrada.papel !== 'admin') {
      throw new ErroApi(403, 'PERMISSAO_NEGADA', 'Esta ação é só para o administrador (extensão Kentro Shop — Admin).');
    }
    req.loja = encontrada.loja;
    req.papel = encontrada.papel;
    return true;
  }
}
