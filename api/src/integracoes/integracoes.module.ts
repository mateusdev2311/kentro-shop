import { Module } from '@nestjs/common';
import { CatalogoKentroController } from '../catalogo-kentro/catalogo-kentro.controller';
import { CatalogoKentroService } from '../catalogo-kentro/catalogo-kentro.service';
import { LojasModule } from '../lojas/lojas.module';
import { CacheCatalogo } from './cache-catalogo';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';
import { ContasNuvemshop, NuvemshopLgpdController, NuvemshopWebhooksController } from './nuvemshop-lgpd.controller';
import { OAuthIniciarController, OAuthRetornoController } from './oauth.controller';
import { SincronizacaoController } from './sincronizacao.controller';
import { SincronizacaoService } from './sincronizacao.service';

@Module({
  imports: [LojasModule],
  controllers: [
    IntegracoesController,
    CatalogoKentroController,
    SincronizacaoController,
    OAuthIniciarController,
    OAuthRetornoController,
    NuvemshopLgpdController,
    NuvemshopWebhooksController,
  ],
  providers: [IntegracoesService, CatalogoKentroService, SincronizacaoService, CacheCatalogo, ContasNuvemshop],
  exports: [IntegracoesService, CacheCatalogo],
})
export class IntegracoesModule {}
