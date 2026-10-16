import { Module } from '@nestjs/common';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { LojasModule } from '../lojas/lojas.module';
import { RegrasController } from '../regras/regras.controller';
import { RegrasService } from '../regras/regras.service';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';

@Module({
  imports: [LojasModule, IntegracoesModule],
  controllers: [CatalogoController, RegrasController],
  providers: [CatalogoService, RegrasService],
  exports: [CatalogoService, RegrasService],
})
export class CatalogoModule {}
