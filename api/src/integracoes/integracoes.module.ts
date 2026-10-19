import { Module } from '@nestjs/common';
import { CatalogoKentroController } from '../catalogo-kentro/catalogo-kentro.controller';
import { CatalogoKentroService } from '../catalogo-kentro/catalogo-kentro.service';
import { LojasModule } from '../lojas/lojas.module';
import { IntegracoesController } from './integracoes.controller';
import { IntegracoesService } from './integracoes.service';
import { NuvemshopLgpdController } from './nuvemshop-lgpd.controller';
import { OAuthIniciarController, OAuthRetornoController } from './oauth.controller';

@Module({
  imports: [LojasModule],
  controllers: [IntegracoesController, CatalogoKentroController, OAuthIniciarController, OAuthRetornoController, NuvemshopLgpdController],
  providers: [IntegracoesService, CatalogoKentroService],
  exports: [IntegracoesService],
})
export class IntegracoesModule {}
