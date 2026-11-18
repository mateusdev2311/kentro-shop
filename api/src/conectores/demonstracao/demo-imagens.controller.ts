import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ErroApi } from '../../comum/erros';
import { svgDaImagem, svgDoBannerDemo } from './nichos';

// Imagens dos produtos e banners de exemplo, desenhadas na hora a partir dos dados da demo. Públicas (são só
// desenhos de produtos fictícios) e com cache longo: mudam só quando os dados da demo mudam, num deploy.

function enviar(res: Response, svg: string | null): void {
  if (!svg) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Imagem não encontrada.');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // O SVG é desenhado aqui, mas por garantia: aberto direto no navegador, nada de script nem recurso de fora.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(svg);
}

@Controller('demo')
export class DemoImagensController {
  @Get('imagens/:arquivo')
  imagem(@Param('arquivo') arquivo: string, @Res() res: Response): void {
    enviar(res, svgDaImagem(arquivo));
  }

  @Get('banners/:arquivo')
  banner(@Param('arquivo') arquivo: string, @Res() res: Response): void {
    enviar(res, svgDoBannerDemo(arquivo));
  }
}
