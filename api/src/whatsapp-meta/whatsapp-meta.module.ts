import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { LojasModule } from '../lojas/lojas.module';
import { SessoesModule } from '../sessoes/sessoes.module';
import { CarrosselController, WhatsappMetaController } from './whatsapp-meta.controller';
import { WhatsappMetaService } from './whatsapp-meta.service';

@Module({
  imports: [LojasModule, CatalogoModule, SessoesModule],
  controllers: [WhatsappMetaController, CarrosselController],
  providers: [WhatsappMetaService],
  exports: [WhatsappMetaService],
})
export class WhatsappMetaModule {}
