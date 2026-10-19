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
  /** App de parceiro da Nuvemshop (OAuth). null = a plataforma não aparece na integração. */
  nuvemshop: { appId: string; clientSecret: string } | null;
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
    // PORT é a "porta interna" que a VPS injeta; PORTA fica para uso local.
    porta: Number(env.PORTA || env.PORT || 3000),
    databaseUrl: env.DATABASE_URL!.trim(),
    chaveMestra,
    tokenSuperadmin: env.TOKEN_SUPERADMIN!.trim(),
    urlPublica: env.URL_PUBLICA!.trim().replace(/\/+$/, ''),
    dirExtensao: env.DIR_EXTENSAO || path.join(dist, 'extensao'),
    dirPublic: env.DIR_PUBLIC || path.join(dist, 'public'),
    nuvemshop: lerNuvemshop(env),
  };
}

/** NUVEMSHOP_APP_ID e NUVEMSHOP_CLIENT_SECRET (painel de parceiros > Chaves de acesso): os dois ou nenhum. */
function lerNuvemshop(env: NodeJS.ProcessEnv): ConfigApp['nuvemshop'] {
  const appId = env.NUVEMSHOP_APP_ID?.trim() ?? '';
  const clientSecret = env.NUVEMSHOP_CLIENT_SECRET?.trim() ?? '';
  if (!appId && !clientSecret) return null;
  if (!/^\d+$/.test(appId) || !clientSecret) {
    throw new Error('Para a Nuvemshop, defina NUVEMSHOP_APP_ID (número) e NUVEMSHOP_CLIENT_SECRET juntos.');
  }
  return { appId, clientSecret };
}
