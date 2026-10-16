import { Module } from '@nestjs/common';
import { ChaveLojaGuard } from './chave-loja.guard';
import { LojasController } from './lojas.controller';
import { LojasService } from './lojas.service';

@Module({
  controllers: [LojasController],
  providers: [LojasService, ChaveLojaGuard],
  exports: [LojasService, ChaveLojaGuard],
})
export class LojasModule {}
