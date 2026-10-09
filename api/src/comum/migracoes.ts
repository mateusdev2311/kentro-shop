import { execFileSync } from 'node:child_process';

// Aplica as migrações pendentes com o CLI do Prisma (dependência de produção).
// Num banco já migrado não faz nada.
export function aplicarMigracoes(databaseUrl: string, schemaPath: string): void {
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schemaPath], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
