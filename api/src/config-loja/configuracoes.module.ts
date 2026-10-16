import { Module } from '@nestjs/common';
import { LojasModule } from '../lojas/lojas.module';
import { ConfiguracoesController, LogoPublicoController } from './configuracoes.controller';

/** Rotas de configuração da loja. O ConfigLojaService vem do ConfigLojaModule (global). */
@Module({
  imports: [LojasModule],
  controllers: [ConfiguracoesController, LogoPublicoController],
})
export class ConfiguracoesModule {}
