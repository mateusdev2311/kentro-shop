import { PrismaClient } from '@prisma/client';

export async function limparBanco(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE lojas CASCADE');
}
