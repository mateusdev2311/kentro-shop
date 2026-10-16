import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { LojasModule } from '../lojas/lojas.module';
import { CarrinhoService } from './carrinho.service';
import { CatalogoPublicoController } from './catalogo-publico.controller';
import { SessoesController } from './sessoes.controller';
import { SessoesService } from './sessoes.service';
import { TokenSessaoGuard } from './token-sessao.guard';

@Module({
  imports: [LojasModule, CatalogoModule],
  controllers: [SessoesController, CatalogoPublicoController],
  providers: [SessoesService, CarrinhoService, TokenSessaoGuard],
  exports: [SessoesService, CarrinhoService],
})
export class SessoesModule {}
