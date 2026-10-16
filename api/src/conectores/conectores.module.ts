import { DynamicModule, Module } from '@nestjs/common';
import { conectorDemonstracao } from './demonstracao/demonstracao.conector';
import { conectorEcommercenet } from './ecommercenet/ecommercenet.conector';
import { Conector } from './nucleo/conector';
import { CONECTORES, RegistroConectores } from './nucleo/registro';

/** Conectores disponíveis em produção. */
export const CONECTORES_PADRAO: Conector[] = [conectorEcommercenet, conectorDemonstracao];

@Module({})
export class ConectoresModule {
  static com(conectores: Conector[] = CONECTORES_PADRAO): DynamicModule {
    return {
      module: ConectoresModule,
      global: true,
      providers: [{ provide: CONECTORES, useValue: conectores }, RegistroConectores],
      exports: [RegistroConectores],
    };
  }
}
