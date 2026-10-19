import { DynamicModule, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { CatalogoPaginaController } from './catalogo/catalogo-pagina.controller';
import { CatalogoModule } from './catalogo/catalogo.module';
import { ConfigApp, CONFIG_APP } from './comum/config';
import { ConfigLojaModule } from './config-loja/config-loja.module';
import { ConfiguracoesModule } from './config-loja/configuracoes.module';
import { PrismaService } from './comum/prisma.service';
import { ConectoresModule, conectoresPadrao } from './conectores/conectores.module';
import { Conector } from './conectores/nucleo/conector';
import { ExtensaoController } from './arquivos-extensao/extensao.controller';
import { IntegracoesModule } from './integracoes/integracoes.module';
import { LojasModule } from './lojas/lojas.module';
import { SaudeController } from './saude/saude.controller';
import { SessoesModule } from './sessoes/sessoes.module';

export interface OpcoesApp {
  /** Substitui os conectores de produção (usado nos testes). */
  conectores?: Conector[];
}

@Module({})
export class AppModule {
  static com(config: ConfigApp, opcoes: OpcoesApp = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        // O ThrottlerModule é global: todos os limites nomeados ficam aqui. Cada rota pula os que não são dela.
        ThrottlerModule.forRoot([
          { name: 'registro', limit: 5, ttl: 3_600_000 },
          { name: 'publico', limit: 120, ttl: 60_000 },
        ]),
        ConectoresModule.com(opcoes.conectores ?? conectoresPadrao(config)), ConfigLojaModule, LojasModule, AdminModule, IntegracoesModule, CatalogoModule, SessoesModule, ConfiguracoesModule],
      providers: [{ provide: CONFIG_APP, useValue: config }, PrismaService],
      exports: [CONFIG_APP, PrismaService],
      controllers: [SaudeController, ExtensaoController, CatalogoPaginaController],
    };
  }
}
