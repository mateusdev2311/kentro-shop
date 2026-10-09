import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigApp } from './config';
import { FiltroDeErros } from './erros';

export function configurarApp(app: NestExpressApplication, config: ConfigApp): void {
  // A VPS fica atrás de um proxy: o IP real do cliente vem no X-Forwarded-For.
  app.set('trust proxy', 1);
  // Arquivos do build do catálogo (assets com hash). Sem index: GET / é a verificação de saúde.
  app.useStaticAssets(config.dirPublic, { index: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new FiltroDeErros());
}
