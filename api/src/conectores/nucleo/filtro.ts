import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { ErroConector, traduzirErroConector } from './erros';

/** Traduz os erros dos conectores para o formato padrão da API (spec 7.2). */
@Catch(ErroConector)
export class FiltroErrosConector implements ExceptionFilter {
  catch(erro: ErroConector, host: ArgumentsHost): void {
    const traduzido = traduzirErroConector(erro);
    host.switchToHttp().getResponse<Response>().status(traduzido.getStatus()).json(traduzido.getResponse());
  }
}
