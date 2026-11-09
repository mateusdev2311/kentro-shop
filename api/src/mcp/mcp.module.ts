import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { LojasModule } from '../lojas/lojas.module';
import { SessoesModule } from '../sessoes/sessoes.module';
import { WhatsappMetaModule } from '../whatsapp-meta/whatsapp-meta.module';
import { FerramentasMcpService } from './ferramentas.service';
import { McpController } from './mcp.controller';

@Module({
  imports: [LojasModule, CatalogoModule, IntegracoesModule, SessoesModule, WhatsappMetaModule],
  controllers: [McpController],
  providers: [FerramentasMcpService],
})
export class McpModule {}
