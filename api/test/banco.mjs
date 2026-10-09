// Postgres real e embutido (sem Docker) para testes e desenvolvimento local.
// É ESM porque o pacote embedded-postgres só existe nesse formato.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

export async function iniciarBanco({ porta, pasta, persistente = false, banco = 'kentro_shop' }) {
  const pg = new EmbeddedPostgres({
    databaseDir: pasta,
    port: porta,
    user: 'kentro',
    password: 'kentro',
    persistent: persistente,
    onLog: () => {},
  });
  // initdb recusa pasta que já é um cluster: só inicializa na primeira vez.
  if (!existsSync(join(pasta, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(banco);
  } catch {
    // banco já existe (modo persistente)
  }
  return {
    url: `postgresql://kentro:kentro@localhost:${porta}/${banco}`,
    parar: () => pg.stop(),
  };
}
