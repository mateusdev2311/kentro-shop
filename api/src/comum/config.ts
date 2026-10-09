import * as path from 'node:path';

export const CONFIG_APP = Symbol('CONFIG_APP');

export interface ConfigApp {
  porta: number;
  databaseUrl: string;
  chaveMestra: Buffer;
  tokenSuperadmin: string;
  urlPublica: string;
  dirExtensao: string;
  dirPublic: string;
}

const OBRIGATORIAS = ['DATABASE_URL', 'CHAVE_MESTRA_CRIPTO', 'TOKEN_SUPERADMIN', 'URL_PUBLICA'] as const;

export function lerConfig(env: NodeJS.ProcessEnv): ConfigApp {
  const ausentes = OBRIGATORIAS.filter((nome) => !env[nome]?.trim());
  if (ausentes.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${ausentes.join(', ')}.`);
  }

  const chaveMestra = Buffer.from(env.CHAVE_MESTRA_CRIPTO!.trim(), 'base64');
  if (chaveMestra.length !== 32) {
    throw new Error('CHAVE_MESTRA_CRIPTO precisa ser o base64 de exatamente 32 bytes.');
  }

  // No build, este arquivo fica em dist/comum; extensao/ e public/ ficam em dist/.
  const dist = path.join(__dirname, '..');
  return {
    porta: env.PORTA ? Number(env.PORTA) : 3000,
    databaseUrl: env.DATABASE_URL!.trim(),
    chaveMestra,
    tokenSuperadmin: env.TOKEN_SUPERADMIN!.trim(),
    urlPublica: env.URL_PUBLICA!.trim().replace(/\/+$/, ''),
    dirExtensao: env.DIR_EXTENSAO || path.join(dist, 'extensao'),
    dirPublic: env.DIR_PUBLIC || path.join(dist, 'public'),
  };
}
