import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { LojasModule } from '../lojas/lojas.module';
import { AvisoKentroController, AvisoKentroService } from './aviso-kentro';
import { CarrinhoService } from './carrinho.service';
import { ClientesService } from './clientes.service';
import { CatalogoPublicoController } from './catalogo-publico.controller';
import { SessoesController } from './sessoes.controller';
import { SessoesService } from './sessoes.service';
import { TokenSessaoGuard } from './token-sessao.guard';

@Module({
  imports: [LojasModule, CatalogoModule, IntegracoesModule],
  controllers: [SessoesController, CatalogoPublicoController, AvisoKentroController],
  providers: [SessoesService, CarrinhoService, ClientesService, TokenSessaoGuard, AvisoKentroService],
  exports: [SessoesService, CarrinhoService, ClientesService],
})
export class SessoesModule {}
