import { Module } from '@nestjs/common';
import { LojasModule } from '../lojas/lojas.module';
import { SessoesModule } from '../sessoes/sessoes.module';
import { AutomacaoController } from './automacao.controller';
import { ChaveAutomacaoGuard } from './chave-automacao.guard';

@Module({
  imports: [LojasModule, SessoesModule],
  controllers: [AutomacaoController],
  providers: [ChaveAutomacaoGuard],
})
export class AutomacaoModule {}
