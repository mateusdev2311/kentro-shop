import { PrismaClient } from '@prisma/client';
import { verificarCodificacao } from '../src/comum/prisma.service';

describe('codificação do banco', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('o banco de teste é UTF-8 e guarda setas e emoji', async () => {
    await expect(verificarCodificacao(prisma)).resolves.toBeUndefined();
    const [linha] = await prisma.$queryRawUnsafe<{ texto: string }[]>(`SELECT 'Alterou A1: 1 → 3 🛒' AS texto`);
    expect(linha.texto).toBe('Alterou A1: 1 → 3 🛒');
  });

  it('banco em outra codificação impede a API de subir, com mensagem clara', async () => {
    const falso = { $queryRawUnsafe: async () => [{ server_encoding: 'WIN1252' }] } as unknown as PrismaClient;
    await expect(verificarCodificacao(falso)).rejects.toThrow(
      'O banco de dados precisa usar a codificação UTF8 (está em WIN1252). Crie o banco com ENCODING \'UTF8\'.',
    );
  });
});
