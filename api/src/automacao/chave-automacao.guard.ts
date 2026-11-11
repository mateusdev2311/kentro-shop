import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { RequisicaoDaLoja } from '../lojas/chave-loja.guard';
import { LojasService } from '../lojas/lojas.service';

/**
 * Chave de automação (ksu_) no cabeçalho X-Loja-Chave: a URA da Kentro gera o link do catálogo sem o atendente.
 * Ela só abre as rotas de /v1/automacao; as chaves de admin e de atendimento não valem aqui (e vice-versa).
 */
@Injectable()
export class ChaveAutomacaoGuard implements CanActivate {
  constructor(private readonly lojas: LojasService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoDaLoja>();
    const chave = req.header('X-Loja-Chave')?.trim();
    const loja = chave ? await this.lojas.buscarPorChaveAutomacao(chave) : null;
    if (!loja) {
      throw new ErroApi(401, 'CHAVE_INVALIDA', 'Chave de automação do Kentro Shop inválida. Gere uma nova no admin, aba URA.');
    }
    if (loja.status === 'bloqueada') {
      throw new ErroApi(403, 'LOJA_BLOQUEADA', 'Esta loja está bloqueada no Kentro Shop. Fale com o suporte.');
    }
    req.loja = loja;
    return true;
  }
}
