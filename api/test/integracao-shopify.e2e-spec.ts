import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { CONECTORES_PADRAO } from '../src/conectores/conectores.module';
import { conectorShopify } from '../src/conectores/shopify/shopify.conector';
import { criarAppDeTeste } from './app';
import { conectorFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

describe('integração com a Shopify (admin)', () => {
  let app: INestApplication;
  let chave: string;
  const http = () => request(app.getHttpServer());
  const salvar = (credenciais: object) => http().put('/v1/loja/integracao').set('X-Loja-Chave', chave).send({ plataforma: 'shopify', credenciais });

  beforeAll(async () => {
    app = await criarAppDeTeste(undefined, { conectores: [conectorFalso, conectorShopify] });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    ipSeq += 1;
    chave = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.31.0.${ipSeq}`).send({ nome: 'Loja S' })).body.chaveAdmin;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('a Shopify está entre os conectores de produção', () => {
    expect(CONECTORES_PADRAO.map((c) => c.id)).toContain('shopify');
  });

  it('o admin vê os campos da Shopify e salva as credenciais cifradas; os tokens voltam mascarados', async () => {
    const lista = await http().get('/v1/conectores').set('X-Loja-Chave', chave);
    const shopify = lista.body.find((c: { id: string }) => c.id === 'shopify');
    expect(shopify.capacidades.historicoCliente).toBe(true);
    expect(shopify.camposDeCredencial.map((c: { chave: string }) => c.chave)).toEqual(['dominio', 'token_storefront', 'token_admin']);

    expect((await salvar({ dominio: 'minha-loja.myshopify.com', token_storefront: 'sf-123', token_admin: 'adm-456' })).status).toBe(200);
    const lida = await http().get('/v1/loja/integracao').set('X-Loja-Chave', chave);
    expect(lida.body).toMatchObject({ plataforma: 'shopify', credenciais: { dominio: 'minha-loja.myshopify.com', token_storefront: '••••', token_admin: '••••' } });
    const gravada = await prisma.integracao.findFirstOrThrow();
    expect(Buffer.from(gravada.credenciaisCifradas).toString('utf8')).not.toContain('sf-123');
  });

  it('token da Admin API é opcional e pode ser removido', async () => {
    await salvar({ dominio: 'minha-loja.myshopify.com', token_storefront: 'sf-123', token_admin: 'adm-456' });
    expect((await salvar({ dominio: 'minha-loja.myshopify.com', token_storefront: '••••', token_admin: '' })).status).toBe(200);
    const lida = await http().get('/v1/loja/integracao').set('X-Loja-Chave', chave);
    expect(lida.body.credenciais).toEqual({ dominio: 'minha-loja.myshopify.com', token_storefront: '••••' });
  });

  it('trocar o domínio exige digitar os tokens de novo', async () => {
    await salvar({ dominio: 'minha-loja.myshopify.com', token_storefront: 'sf-123', token_admin: 'adm-456' });
    const res = await salvar({ dominio: 'outra-loja.myshopify.com', token_storefront: '••••', token_admin: '••••' });
    expect(res.status).toBe(400);
    expect(res.body.erro.mensagem).toBe('Ao trocar o endereço, digite de novo: Token da Storefront API, Token da Admin API (opcional).');
    // Mesmo domínio escrito de outro jeito não conta como troca.
    expect((await salvar({ dominio: 'Minha-Loja', token_storefront: '••••', token_admin: '••••' })).status).toBe(200);
  });
});
