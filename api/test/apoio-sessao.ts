import { INestApplication } from '@nestjs/common';
import request from 'supertest';

// Apoio dos testes de sessão: registra loja, integra com o conector falso e gera o link.

let ipSeq = 0;

export interface LojaDeTeste {
  lojaId: string;
  chaveAdmin: string;
  chaveAtendimento: string;
}

export async function lojaIntegrada(app: INestApplication, integrar = true): Promise<LojaDeTeste> {
  ipSeq += 1;
  const http = request(app.getHttpServer());
  const loja = (await http.post('/v1/lojas/registrar').set('X-Forwarded-For', `10.6.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`).send({ nome: 'Loja Teste' })).body;
  if (integrar) {
    await request(app.getHttpServer())
      .put('/v1/loja/integracao')
      .set('X-Loja-Chave', loja.chaveAdmin)
      .send({ plataforma: 'falso', credenciais: { url_api: 'https://api.teste', token: 'certo' } });
  }
  return loja;
}

export async function gerarLink(app: INestApplication, loja: LojaDeTeste, chatId = '100', corpo: object = {}): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/v1/sessoes')
    .set('X-Loja-Chave', loja.chaveAtendimento)
    .send({ chatId, nome: 'Ana Souza', telefone: '5538988887777', ...corpo });
  return String(res.body.url).split('/c/')[1];
}
