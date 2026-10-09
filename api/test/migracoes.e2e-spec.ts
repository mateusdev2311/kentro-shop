import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { aplicarMigracoes } from '../src/comum/migracoes';
import { limparBanco } from './limpar';

describe('migrações e tabela lojas', () => {
  const prisma = new PrismaClient();

  beforeEach(() => limparBanco(prisma));
  afterAll(() => prisma.$disconnect());

  it('reaplicar as migrações num banco já migrado não falha', () => {
    expect(() =>
      aplicarMigracoes(process.env.DATABASE_URL!, path.join(__dirname, '..', 'prisma', 'schema.prisma')),
    ).not.toThrow();
  });

  it('loja nasce pendente de integração, no plano grátis e sem limites', async () => {
    const loja = await prisma.loja.create({
      data: { chaveAdminHash: 'a', chaveAtendimentoHash: 'b', tokenMcpHash: 'c' },
    });
    expect(loja.status).toBe('pendente_integracao');
    expect(loja.plano).toBe('gratis');
    expect(loja.limites).toEqual({});
  });

  it('não aceita duas lojas com o mesmo hash de chave admin', async () => {
    await prisma.loja.create({ data: { chaveAdminHash: 'a', chaveAtendimentoHash: 'b', tokenMcpHash: 'c' } });
    await expect(
      prisma.loja.create({ data: { chaveAdminHash: 'a', chaveAtendimentoHash: 'b2', tokenMcpHash: 'c2' } }),
    ).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });
});
