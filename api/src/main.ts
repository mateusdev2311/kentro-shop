import 'reflect-metadata';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { lerConfig } from './comum/config';
import { configurarApp } from './comum/configurar-app';
import { aplicarMigracoes } from './comum/migracoes';

async function iniciar(): Promise<void> {
  const config = lerConfig(process.env);
  aplicarMigracoes(config.databaseUrl, path.join(__dirname, 'prisma', 'schema.prisma'));
  const app = await NestFactory.create<NestExpressApplication>(AppModule.com(config));
  configurarApp(app, config);
  await app.listen(config.porta);
}

iniciar().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
