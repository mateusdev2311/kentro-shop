import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from './config';

/**
 * O banco precisa ser UTF8: nomes de clientes, emoji e textos da atividade ("→") não cabem em WIN1252/LATIN1.
 * Falhar no boot é melhor que um erro 500 no meio de uma compra.
 */
export async function verificarCodificacao(prisma: PrismaClient): Promise<void> {
  const [linha] = await prisma.$queryRawUnsafe<{ server_encoding: string }[]>('SHOW server_encoding');
  const codificacao = String(linha?.server_encoding ?? '');
  if (codificacao.toUpperCase() !== 'UTF8') {
    throw new Error(`O banco de dados precisa usar a codificação UTF8 (está em ${codificacao}). Crie o banco com ENCODING 'UTF8'.`);
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(CONFIG_APP) config: ConfigApp) {
    super({ datasources: { db: { url: config.databaseUrl } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await verificarCodificacao(this);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
