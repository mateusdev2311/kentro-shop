import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Controller, Get, Inject, Options, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';

const EXTENSOES = new Set(['atendimento', 'admin']);
// Sem barra nem "..": o nome não consegue sair da pasta da extensão.
const ARQUIVO = /^[a-z0-9-]+\.(html|json|js|css|svg|png)$/;
const TIPOS: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
};

function cors(res: Response): void {
  // A Kentro recusa instalar (e montar) extensão cujo host não devolve este cabeçalho.
  res.setHeader('Access-Control-Allow-Origin', '*');
}

@Controller('extensao/:ext/:arquivo')
export class ExtensaoController {
  constructor(@Inject(CONFIG_APP) private readonly config: ConfigApp) {}

  @Options()
  preflight(@Res() res: Response): void {
    cors(res);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.status(204).end();
  }

  @Get()
  async servir(@Param('ext') ext: string, @Param('arquivo') arquivo: string, @Res() res: Response): Promise<void> {
    const naoEncontrado = new ErroApi(404, 'NAO_ENCONTRADO', 'Arquivo da extensão não encontrado.');
    if (!EXTENSOES.has(ext) || !ARQUIVO.test(arquivo)) throw naoEncontrado;

    let conteudo: Buffer;
    try {
      conteudo = await readFile(path.join(this.config.dirExtensao, ext, arquivo));
    } catch {
      throw naoEncontrado;
    }
    if (arquivo === 'manifest.json') {
      conteudo = Buffer.from(conteudo.toString('utf8').split('__URL_PUBLICA__').join(this.config.urlPublica));
    }

    cors(res);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', TIPOS[path.extname(arquivo).slice(1)]);
    res.send(conteudo);
  }
}
