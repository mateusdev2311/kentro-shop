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
import { ABRIR_BANCO, AbrirBanco, abrirBancoPadrao } from './conectores/nucleo/banco';
import { Conector } from './conectores/nucleo/conector';
import { ABRIR_FTP, AbrirFtp, abrirFtpPadrao } from './conectores/nucleo/ftp';
import { ExtensaoController } from './arquivos-extensao/extensao.controller';
import { IntegracoesModule } from './integracoes/integracoes.module';
import { OPCOES_SINCRONIZACAO } from './integracoes/sincronizacao.service';
import { LojasModule } from './lojas/lojas.module';
import { McpModule } from './mcp/mcp.module';
import { SaudeController } from './saude/saude.controller';
import { ENVIO_AVISO, EnvioAviso, enviarAvisoHttp } from './sessoes/aviso-kentro';
import { SessoesModule } from './sessoes/sessoes.module';

export interface OpcoesApp {
  /** Substitui os conectores de produção (usado nos testes). */
  conectores?: Conector[];
  /** Substitui o envio do aviso de pedido finalizado à Kentro (usado nos testes). */
  envioAviso?: EnvioAviso;
  /** Substitui o acesso aos bancos de dados das lojas (usado nos testes). */
  abrirBanco?: AbrirBanco;
  /** Substitui o acesso aos FTPs de fotos das lojas (usado nos testes). */
  abrirFtp?: AbrirFtp;
  /** false desliga a sincronização periódica dos catálogos (testes). Padrão: ligada. */
  sincronizacaoAutomatica?: boolean;
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
        ConectoresModule.com(opcoes.conectores ?? conectoresPadrao(config)), ConfigLojaModule, LojasModule, AdminModule, IntegracoesModule, CatalogoModule, SessoesModule, ConfiguracoesModule, McpModule],
      providers: [
        { provide: CONFIG_APP, useValue: config },
        { provide: ENVIO_AVISO, useValue: opcoes.envioAviso ?? enviarAvisoHttp },
        { provide: ABRIR_BANCO, useValue: opcoes.abrirBanco ?? abrirBancoPadrao },
        { provide: ABRIR_FTP, useValue: opcoes.abrirFtp ?? abrirFtpPadrao },
        { provide: OPCOES_SINCRONIZACAO, useValue: { automatica: opcoes.sincronizacaoAutomatica ?? true } },
        PrismaService,
      ],
      exports: [CONFIG_APP, ENVIO_AVISO, ABRIR_BANCO, ABRIR_FTP, OPCOES_SINCRONIZACAO, PrismaService],
      controllers: [SaudeController, ExtensaoController, CatalogoPaginaController],
    };
  }
}
