import * as path from 'node:path';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';

@Controller('c')
export class CatalogoPaginaController {
  constructor(@Inject(CONFIG_APP) private readonly config: ConfigApp) {}

  // Página única do catálogo (build do storefront). O token é lido pela própria página.
  @Get(':token')
  pagina(@Res() res: Response): void {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(this.config.dirPublic, 'index.html'));
  }
}
