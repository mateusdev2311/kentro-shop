import { DynamicModule, Module } from '@nestjs/common';
import { ConfigApp } from '../comum/config';
import { conectorDemonstracao } from './demonstracao/demonstracao.conector';
import { conectorEcommercenet } from './ecommercenet/ecommercenet.conector';
import { conectorKentro } from './kentro/kentro.conector';
import { Conector } from './nucleo/conector';
import { CONECTORES, RegistroConectores } from './nucleo/registro';
import { criarConectorNuvemshop } from './nuvemshop/nuvemshop.conector';
import { conectorShopify } from './shopify/shopify.conector';

/** Conectores que não dependem de configuração. */
export const CONECTORES_PADRAO: Conector[] = [conectorEcommercenet, conectorShopify, conectorKentro, conectorDemonstracao];

/** Conectores de produção: a Nuvemshop só aparece com o app de parceiro configurado. */
export function conectoresPadrao(config: Pick<ConfigApp, 'nuvemshop' | 'urlPublica'>): Conector[] {
  if (!config.nuvemshop) return CONECTORES_PADRAO;
  const nuvemshop = criarConectorNuvemshop({ ...config.nuvemshop, userAgent: `Kentro Shop (${config.urlPublica})` });
  return [conectorEcommercenet, conectorShopify, nuvemshop, conectorKentro, conectorDemonstracao];
}

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
