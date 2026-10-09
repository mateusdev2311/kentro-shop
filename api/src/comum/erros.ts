import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

export class ErroApi extends HttpException {
  constructor(status: number, readonly codigo: string, readonly mensagem: string) {
    super({ erro: { codigo, mensagem } }, status);
  }
}

const POR_STATUS: Record<number, { codigo: string; mensagem: string }> = {
  [HttpStatus.BAD_REQUEST]: { codigo: 'ENTRADA_INVALIDA', mensagem: 'Os dados enviados são inválidos.' },
  [HttpStatus.NOT_FOUND]: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    codigo: 'LIMITE_DE_REQUISICOES',
    mensagem: 'Muitas requisições seguidas. Aguarde alguns minutos e tente de novo.',
  },
};

@Catch()
export class FiltroDeErros implements ExceptionFilter {
  private readonly logger = new Logger('Erros');

  catch(excecao: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (excecao instanceof ErroApi) {
      res.status(excecao.getStatus()).json(excecao.getResponse());
      return;
    }

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      const padrao = POR_STATUS[status];
      if (padrao) {
        res.status(status).json({ erro: { codigo: padrao.codigo, mensagem: this.mensagemDe(excecao, padrao.mensagem) } });
        return;
      }
      if (status < 500) {
        res.status(status).json({ erro: { codigo: 'ERRO_NA_REQUISICAO', mensagem: 'Não foi possível atender a requisição.' } });
        return;
      }
    }

    this.logger.error(excecao instanceof Error ? excecao.stack ?? excecao.message : String(excecao));
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente de novo em instantes.' } });
  }

  // Erros do ValidationPipe trazem a lista do que está errado; os demais usam a mensagem padrão.
  private mensagemDe(excecao: HttpException, padrao: string): string {
    if (!(excecao instanceof BadRequestException)) return padrao;
    const corpo = excecao.getResponse();
    const detalhes = typeof corpo === 'object' && corpo !== null ? (corpo as { message?: unknown }).message : undefined;
    return Array.isArray(detalhes) ? `${padrao} ${detalhes.join('; ')}` : padrao;
  }
}
