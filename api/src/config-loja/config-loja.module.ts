import { Global, Module } from '@nestjs/common';
import { ConfigLojaService } from './config-loja.service';

@Global()
@Module({
  providers: [ConfigLojaService],
  exports: [ConfigLojaService],
})
export class ConfigLojaModule {}
