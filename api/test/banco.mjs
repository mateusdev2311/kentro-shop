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
  // No Windows o cluster nasce em WIN1252 (codificação do sistema), que não guarda "→" nem emoji.
  // O initdb em UTF8 falha com o "ã" do caminho do projeto; então o BANCO é criado em UTF8 a partir do template0.
  const cliente = pg.getPgClient('postgres');
  await cliente.connect();
  try {
    const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [banco]);
    if (!existe.rowCount) {
      await cliente.query(`CREATE DATABASE "${banco}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    }
  } finally {
    await cliente.end();
  }
  return {
    url: `postgresql://kentro:kentro@localhost:${porta}/${banco}`,
    parar: () => pg.stop(),
  };
}
