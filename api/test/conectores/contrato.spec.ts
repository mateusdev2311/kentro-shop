import { conectorDemonstracao } from '../../src/conectores/demonstracao/demonstracao.conector';
import { conectorEcommercenet } from '../../src/conectores/ecommercenet/ecommercenet.conector';
import { conectorShopify } from '../../src/conectores/shopify/shopify.conector';
import { conectorFalso } from './conector-falso';
import { criarFetchShopify, SHOPIFY_CREDENCIAIS } from './fixtures-shopify';
import { rodarContrato } from './contrato';
import { criarFetchEcn, ECN_CREDENCIAIS } from './fixtures-ecommercenet';

rodarContrato('falso', () => ({
  conector: conectorFalso,
  credenciaisValidas: { url_api: 'https://api.teste', token: 'certo' },
  credenciaisInvalidas: { url_api: 'https://api.teste', token: 'errado' },
  idSimples: 'A1',
  idComVariacao: 'C3',
  idInexistente: 'ZZ9',
  buscaVazia: 'zzzzzz',
  porPagina: 2,
}));

rodarContrato('eCommerce-net', () => ({
  conector: conectorEcommercenet,
  credenciaisValidas: ECN_CREDENCIAIS,
  credenciaisInvalidas: { ...ECN_CREDENCIAIS, client_secret: 'errado' },
  fetchDeFixtures: criarFetchEcn(),
  idSimples: 'PRC-6060-CAL',
  idComVariacao: 'VNL-CARV',
  idInexistente: 'NAO-EXISTE',
  buscaVazia: 'zzzzzz',
  porPagina: 2,
}));

rodarContrato('Shopify (respostas sintéticas)', () => ({
  conector: conectorShopify,
  credenciaisValidas: SHOPIFY_CREDENCIAIS,
  credenciaisInvalidas: { ...SHOPIFY_CREDENCIAIS, token_storefront: 'errado' },
  fetchDeFixtures: criarFetchShopify(),
  idSimples: 'porcelanato-calacata',
  idComVariacao: 'tinta-acrilica',
  idInexistente: 'nao-existe',
  buscaVazia: 'zzzzzz',
  porPagina: 2,
}));

rodarContrato('Demonstração', () => ({
  conector: conectorDemonstracao,
  credenciaisValidas: { codigo: 'demo' },
  credenciaisInvalidas: { codigo: 'outro' },
  idSimples: 'PRC-6060-CAL',
  idComVariacao: 'PRC-2090-MAD',
  idInexistente: 'NAO-EXISTE',
  buscaVazia: 'zzzzzz',
  porPagina: 10,
}));
