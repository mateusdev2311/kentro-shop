import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigApp } from './config';
import { FiltroDeErros } from './erros';

export function configurarApp(app: NestExpressApplication, config: ConfigApp): void {
  // A VPS fica atrás de um proxy: o IP real do cliente vem no X-Forwarded-For.
  app.set('trust proxy', 1);
  // Arquivos do build do catálogo (assets com hash). Sem index: GET / é a verificação de saúde.
  // O nome dos arquivos de assets/ muda a cada build (hash do Vite): podem ficar em cache para sempre.
  app.useStaticAssets(config.dirPublic, {
    index: false,
    setHeaders: (res, caminho) => {
      if (/[\\/]assets[\\/]/.test(caminho)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new FiltroDeErros());
}
