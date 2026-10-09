import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ChaveLojaGuard } from './chave-loja.guard';
import { LojasController } from './lojas.controller';
import { LojasService } from './lojas.service';

@Module({
  // Só a rota de registro usa o ThrottlerGuard; o limite dela vem do @Throttle.
  imports: [ThrottlerModule.forRoot([{ name: 'registro', limit: 5, ttl: 3_600_000 }])],
  controllers: [LojasController],
  providers: [LojasService, ChaveLojaGuard],
  exports: [LojasService, ChaveLojaGuard],
})
export class LojasModule {}
