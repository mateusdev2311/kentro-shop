// Postgres local para desenvolvimento: `npm run db:local` (fica rodando até Ctrl+C).
import { join } from 'node:path';
import { iniciarBanco } from '../test/banco.mjs';

const banco = await iniciarBanco({
  porta: 54329,
  pasta: join(import.meta.dirname, '..', '.db-local'),
  persistente: true,
});
console.log(`Postgres local rodando. DATABASE_URL=${banco.url}`);

const encerrar = async () => {
  await banco.parar();
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
setInterval(() => {}, 1 << 30);
