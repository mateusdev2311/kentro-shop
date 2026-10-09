import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export default async function () {
  const banco = globalThis.__BANCO_DE_TESTE__;
  if (!banco) return;
  await banco.parar();
  await rm(dirname(banco.pasta), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}
