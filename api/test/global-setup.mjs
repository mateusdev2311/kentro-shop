import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarBanco } from './banco.mjs';

export default async function () {
  const pasta = join(mkdtempSync(join(tmpdir(), 'kentro-shop-teste-')), 'pg');
  // persistente: no Windows o próprio pacote falha ao apagar a pasta (EBUSY); o teardown apaga com novas tentativas.
  const banco = await iniciarBanco({ porta: 54330, pasta, persistente: true, banco: 'kentro_shop_teste' });
  globalThis.__BANCO_DE_TESTE__ = { ...banco, pasta };
  process.env.DATABASE_URL = banco.url;

  const require = createRequire(import.meta.url);
  try {
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      env: { ...process.env, DATABASE_URL: banco.url },
      stdio: 'pipe',
    });
  } catch (erro) {
    await banco.parar();
    throw erro;
  }
}
