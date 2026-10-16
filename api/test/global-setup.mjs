import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarBanco } from './banco.mjs';

/**
 * Porta livre a cada rodada: no Windows, um processo filho do Postgres de uma rodada interrompida
 * pode continuar segurando a porta, e uma porta fixa derrubaria todas as rodadas seguintes.
 */
function portaLivre() {
  return new Promise((resolver, rejeitar) => {
    const servidor = createServer();
    servidor.unref();
    servidor.on('error', rejeitar);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

export default async function () {
  const pasta = join(mkdtempSync(join(tmpdir(), 'kentro-shop-teste-')), 'pg');
  // persistente: no Windows o próprio pacote falha ao apagar a pasta (EBUSY); o teardown apaga com novas tentativas.
  const banco = await iniciarBanco({ porta: await portaLivre(), pasta, persistente: true, banco: 'kentro_shop_teste' });
  globalThis.__BANCO_DE_TESTE__ = { ...banco, pasta };
  process.env.DATABASE_URL = banco.url;

  const require = createRequire(import.meta.url);
  try {
    const schema = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: banco.url },
      stdio: 'pipe',
    });
  } catch (erro) {
    await banco.parar();
    throw erro;
  }
}
