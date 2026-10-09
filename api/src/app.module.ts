import { DynamicModule, Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { CatalogoPaginaController } from './catalogo/catalogo-pagina.controller';
import { ConfigApp, CONFIG_APP } from './comum/config';
import { PrismaService } from './comum/prisma.service';
import { ExtensaoController } from './arquivos-extensao/extensao.controller';
import { LojasModule } from './lojas/lojas.module';
import { SaudeController } from './saude/saude.controller';

@Module({})
export class AppModule {
  static com(config: ConfigApp): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [LojasModule, AdminModule],
      providers: [{ provide: CONFIG_APP, useValue: config }, PrismaService],
      exports: [CONFIG_APP, PrismaService],
      controllers: [SaudeController, ExtensaoController, CatalogoPaginaController],
    };
  }
}
