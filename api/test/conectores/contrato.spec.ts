import { conectorDemonstracao } from '../../src/conectores/demonstracao/demonstracao.conector';
import { conectorEcommercenet } from '../../src/conectores/ecommercenet/ecommercenet.conector';
import { conectorKentro } from '../../src/conectores/kentro/kentro.conector';
import { conectorShopify } from '../../src/conectores/shopify/shopify.conector';
import { criarConectorNuvemshop } from '../../src/conectores/nuvemshop/nuvemshop.conector';
import { categoriasDaView, conectorAutomatiza, produtoDaView } from '../../src/conectores/automatiza/automatiza.conector';
import { ProdutoSincronizado } from '../../src/conectores/nucleo/conector';
import { bancoEmMemoria, CREDENCIAIS_BANCO, LINHAS_VIEW } from './banco-memoria';
import { catalogoEmMemoria, copiaEmMemoria } from './catalogo-memoria';
import { APP_TESTE, criarFetchNuvemshop, NUVEMSHOP_CREDENCIAIS } from './fixtures-nuvemshop';
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

rodarContrato('Nuvemshop (respostas sintéticas)', () => ({
  conector: criarConectorNuvemshop(APP_TESTE),
  credenciaisValidas: NUVEMSHOP_CREDENCIAIS,
  credenciaisInvalidas: { ...NUVEMSHOP_CREDENCIAIS, access_token: 'errado' },
  fetchDeFixtures: criarFetchNuvemshop(),
  idSimples: '101',
  idComVariacao: '102',
  idInexistente: '999',
  buscaVazia: 'zzzzzz',
  porPagina: 2,
}));

rodarContrato('Kentro (cópia sincronizada em memória)', () => ({
  conector: conectorKentro,
  credenciaisValidas: {},
  catalogoLocal: () => catalogoEmMemoria(),
  idSimples: '1',
  idComVariacao: '1',
  idInexistente: '999',
  buscaVazia: 'zzzzzz',
  porPagina: 3,
}));

rodarContrato('ERP Automatiza (banco e cópia em memória)', () => {
  const produtos = LINHAS_VIEW.map(produtoDaView).filter((p): p is ProdutoSincronizado => !!p);
  const categorias = categoriasDaView(LINHAS_VIEW, new Set(produtos.flatMap((p) => p.produto.categoriaIds)));
  return {
    conector: conectorAutomatiza,
    credenciaisValidas: CREDENCIAIS_BANCO,
    credenciaisInvalidas: { ...CREDENCIAIS_BANCO, senha: 'errada' },
    catalogoLocal: () => copiaEmMemoria(produtos, categorias),
    banco: (credenciais) => bancoEmMemoria(credenciais),
    idSimples: '101',
    idComVariacao: '101',
    idInexistente: '201',
    buscaVazia: 'zzzzzz',
    porPagina: 3,
  };
});

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
