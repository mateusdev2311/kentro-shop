import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { conectorAutomatiza, idCategoria } from '../src/conectores/automatiza/automatiza.conector';
import { conectorKentro } from '../src/conectores/kentro/kentro.conector';
import { AbrirBanco } from '../src/conectores/nucleo/banco';
import { SincronizacaoService } from '../src/integracoes/sincronizacao.service';
import { criarAppDeTeste } from './app';
import { bancoEmMemoria, CREDENCIAIS_BANCO, LINHAS_VIEW, OpcoesBancoMemoria, TabelasPedido, tabelasVazias } from './conectores/banco-memoria';
import { PRODUTOS_SDK } from './conectores/catalogo-memoria';
import { conectorFalso } from './conectores/conector-falso';
import { limparBanco } from './limpar';

const prisma = new PrismaClient();
let ipSeq = 0;

describe('catálogo de banco de dados sincronizado pela API (ERP Automatiza)', () => {
  let app: INestApplication;
  let loja: { lojaId: string; chaveAdmin: string; chaveAtendimento: string };
  /** O que o banco falso responde agora (cada teste muda). */
  let banco: OpcoesBancoMemoria = {};
  /** Tabelas de pedido do servidor do ERP (todas as filiais). */
  let tabelas: TabelasPedido = tabelasVazias();
  /** Consultas feitas ao banco (abrir o cliente não conecta; só consultar). */
  const abertos: { lojaId: string; motor: string; bancoPadrao?: string; operacao: string }[] = [];
  const abrirBanco: AbrirBanco = (o) => {
    const cliente = bancoEmMemoria(o.credenciais, { tabelas, ...banco });
    return {
      consultar: (operacao, sql, parametros) => {
        abertos.push({ lojaId: o.lojaId, motor: o.motor, bancoPadrao: o.bancoPadrao, operacao });
        return cliente.consultar(operacao, sql, parametros);
      },
      gravar: (operacao, liberadas, passos) => {
        abertos.push({ lojaId: o.lojaId, motor: o.motor, bancoPadrao: o.bancoPadrao, operacao });
        return cliente.gravar!(operacao, liberadas, passos);
      },
    };
  };

  const http = () => request(app.getHttpServer());
  const salvar = (credenciais: object = CREDENCIAIS_BANCO, plataforma = 'automatiza') =>
    http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma, credenciais });
  const sincronizar = (chave = loja.chaveAdmin) => http().post('/v1/loja/catalogo-sincronizado/sincronizar').set('X-Loja-Chave', chave);
  const estado = () => http().get('/v1/loja/catalogo-sincronizado').set('X-Loja-Chave', loja.chaveAtendimento);
  const testar = () => http().post('/v1/loja/integracao/testar').set('X-Loja-Chave', loja.chaveAdmin);
  const produtos = (query = '') => http().get(`/v1/loja/catalogo/produtos${query}`).set('X-Loja-Chave', loja.chaveAtendimento);

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { conectores: [conectorFalso, conectorKentro, conectorAutomatiza], abrirBanco });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    banco = {};
    tabelas = tabelasVazias();
    abertos.length = 0;
    ipSeq += 1;
    loja = (await http().post('/v1/lojas/registrar').set('X-Forwarded-For', `10.9.0.${ipSeq}`).send({ nome: 'Farmácia' })).body;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('o conector aparece com a sincronização e os campos do banco (senha mascarada na leitura)', async () => {
    const lista = (await http().get('/v1/conectores').set('X-Loja-Chave', loja.chaveAdmin)).body as { id: string; sincronizacao?: object; camposDeCredencial: { chave: string }[] }[];
    const automatiza = lista.find((c) => c.id === 'automatiza')!;
    expect(automatiza.sincronizacao).toEqual({ minutos: 15 });
    expect(automatiza.camposDeCredencial.map((c) => c.chave)).toEqual([
      'host',
      'porta',
      'usuario',
      'senha',
      'banco',
      'ftp_host',
      'ftp_porta',
      'ftp_usuario',
      'ftp_senha',
      'ftp_pasta',
      'pedido_parceiro',
      'pedido_canal',
      'pedido_codigo_parceiro',
    ]);
    expect(lista.find((c) => c.id === 'falso')!.sincronizacao).toBeUndefined();

    expect((await salvar()).body.credenciais).toEqual({ ...CREDENCIAIS_BANCO, senha: '••••', banco: undefined });
  });

  it('recusa salvar servidor da rede interna', async () => {
    const r = await salvar({ ...CREDENCIAIS_BANCO, host: '10.0.0.8' });
    expect(r.status).toBe(400);
    expect(r.body.erro.mensagem).toMatch(/endereço público/);
  });

  it('salvar, sincronizar e testar: o catálogo lê a cópia (busca pelo código de barras), sem ir ao banco', async () => {
    await salvar();
    expect((await testar()).body).toEqual({
      ok: false,
      mensagem: 'Banco conectado (FARMACIA TESTE - LOJA07), mas os produtos ainda não foram sincronizados. Clique em "Sincronizar agora".',
    });

    const r = await sincronizar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 5, categorias: 3, sincronizando: false, ultimoErro: null });
    expect(abertos.at(-1)).toEqual({ lojaId: loja.lojaId, motor: 'mysql', bancoPadrao: 'automatiza', operacao: 'sincronizar_catalogo' });

    expect((await testar()).body).toEqual({ ok: true, nomeLoja: 'FARMACIA TESTE - LOJA07 (5 produtos)' });
    expect((await http().get('/v1/loja').set('X-Loja-Chave', loja.chaveAdmin)).body.status).toBe('ativa');

    abertos.length = 0;
    expect((await produtos('?busca=7890000000104')).body.itens.map((p: { nome: string }) => p.nome)).toEqual(['PROTETOR SOLAR FPS50 120ML']);
    expect((await produtos(`?categoria=${idCategoria('DERMOCOSMETICOS')}`)).body.itens).toHaveLength(2);
    const categorias = (await http().get('/v1/loja/catalogo/categorias').set('X-Loja-Chave', loja.chaveAtendimento)).body;
    expect(categorias.map((c: { nome: string }) => c.nome)).toEqual(['Dermocosmeticos', 'Generico OTC', 'Higiene e Beleza']);
    expect(abertos).toEqual([]); // as leituras do catálogo não abrem o banco

    // O registro de chamadas (aba Saúde) tem a leitura do banco, sem SQL nem credencial.
    const chamadas = await prisma.chamadaConector.findMany({ where: { lojaId: loja.lojaId }, select: { plataforma: true } });
    expect(chamadas.every((c) => c.plataforma === 'automatiza')).toBe(true);
  });

  it('só o admin sincroniza', async () => {
    await salvar();
    expect((await sincronizar(loja.chaveAtendimento)).status).toBe(403);
  });

  it('falha no banco: a cópia anterior continua e o motivo fica no estado', async () => {
    await salvar();
    await sincronizar();
    banco = { fora: true };
    const r = await sincronizar();
    expect(r.status).toBe(502);
    expect((await estado()).body).toMatchObject({ total: 5, ultimoErro: 'A plataforma de e-commerce não respondeu. Tente de novo em instantes.' });
    expect((await produtos()).body.itens).toHaveLength(5);

    banco = {};
    expect((await sincronizar()).body).toMatchObject({ total: 5, ultimoErro: null });
  });

  it('nada veio do banco: recusa e mantém a cópia; a automática também recusa perder mais da metade', async () => {
    await salvar();
    await sincronizar();
    banco = { linhas: [] };
    expect((await sincronizar()).body.erro.codigo).toBe('CATALOGO_VAZIO');

    banco = { linhas: LINHAS_VIEW.slice(0, 2) };
    const sinc = app.get(SincronizacaoService);
    await expect(sinc.sincronizar(loja.lojaId, { automatica: true })).rejects.toMatchObject({ codigo: 'CATALOGO_ENCOLHEU' });
    expect((await estado()).body.total).toBe(5);
    // A manual aceita: alguém pediu e está olhando.
    expect((await sincronizar()).body.total).toBe(2);
  });

  it('plataforma lida ao vivo não sincroniza', async () => {
    await salvar({ url_api: 'https://api.teste', token: 'certo' }, 'falso');
    const r = await sincronizar();
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('SEM_SINCRONIZACAO');
  });

  it('trocar de plataforma apaga a cópia da anterior', async () => {
    await http().put('/v1/loja/integracao').set('X-Loja-Chave', loja.chaveAdmin).send({ plataforma: 'kentro', credenciais: {} });
    await http()
      .post('/v1/loja/catalogo-kentro/lotes')
      .set('X-Loja-Chave', loja.chaveAdmin)
      .send({ lote: 'lote-0001', parte: 0, ultima: true, produtos: PRODUTOS_SDK });
    expect((await estado()).body.total).toBe(4);

    await salvar();
    expect((await estado()).body).toMatchObject({ total: 0, sincronizadoEm: null });
    expect((await testar()).body.ok).toBe(false); // não aparece o catálogo da Kentro como se fosse o do banco
  });

  describe('pedido no ERP ao finalizar', () => {
    const ENTREGA = { nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '35790000', estado: 'MG', cidade: 'Curvelo', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: '', referencia: '' };
    let pedidoSeq = 0;
    const cliente = () => {
      pedidoSeq += 1;
      return `10.19.${Math.floor(pedidoSeq / 250)}.${pedidoSeq % 250}`;
    };
    const preparar = async (credenciais: object = { ...CREDENCIAIS_BANCO, pedido_parceiro: 'K' }) => {
      await salvar(credenciais);
      await sincronizar();
      await http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send({ modoPedido: 'criar_pedido' });
      const link = await http().post('/v1/sessoes').set('X-Loja-Chave', loja.chaveAtendimento).send({ chatId: '300', nome: 'Ana Souza', telefone: '5538988887777' });
      const token = String(link.body.url).split('/c/')[1];
      await http().put(`/v1/catalogo/${token}/carrinho`).set('X-Forwarded-For', cliente()).send({ itens: [{ produtoId: '101', quantidade: 2 }, { produtoId: '103', quantidade: 1 }] });
      return token;
    };
    const abrir = (token: string) => http().get(`/v1/catalogo/${token}/abrir`).set('X-Forwarded-For', cliente());
    const finalizar = (token: string, corpo: object) => http().post(`/v1/catalogo/${token}/finalizar`).set('X-Forwarded-For', cliente()).send({ tipo: 'entrega', entrega: ENTREGA, ...corpo });

    it('o cliente escolhe o pagamento (sem e-mail) e o pedido entra nas tabelas do ERP, na filial do banco', async () => {
      const token = await preparar();
      expect((await abrir(token)).body).toMatchObject({ pedidoNaLoja: true, pagamentoNaEntrega: true });

      const semPagamento = await finalizar(token, {});
      expect(semPagamento.status).toBe(400);
      expect(semPagamento.body.erro.mensagem).toBe('Escolha a forma de pagamento.');
      const trocoPequeno = await finalizar(token, { pagamento: { forma: 'dinheiro', trocoPara: 10 } });
      expect(trocoPequeno.status).toBe(400);
      expect(trocoPequeno.body.erro.mensagem).toMatch(/troco precisa ser para um valor igual ou maior que o total \(R\$ 14,88\)/);

      const r = await finalizar(token, { pagamento: { forma: 'dinheiro', trocoPara: 50 } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'pedido_criado', pedido: { idExterno: '7-107834', numero: '107834', status: 'ATIVO' } });
      expect(r.body.checkout.pagamento).toEqual({ forma: 'dinheiro', trocoPara: 50 });

      expect(tabelas.pedido_ecommerce).toHaveLength(1);
      expect(tabelas.pedido_ecommerce[0]).toMatchObject({
        filiCodigo: 7,
        peecParceiro: 'K',
        peecValor_Total: 14.88,
        peecNome_Cliente: 'Ana Souza',
        peecCep_Entrega: '35790000',
        peecDescricao_Pagamento: 'Dinheiro na entrega (troco para R$ 50,00)',
        Status_Transmissao: 'N',
      });
      expect(tabelas.itens_pedido_ecommerce.map((i) => [i.Codigo_Mercadoria, i.itpeQuantidade, i.itpeValor])).toEqual([
        [101, 2, 3.99],
        [103, 1, 6.9],
      ]);

      const painel = (await http().get('/v1/sessoes/chat/300').set('X-Loja-Chave', loja.chaveAtendimento)).body;
      expect(painel.resumo).toContain('Pagamento: Dinheiro na entrega (troco para R$ 50,00)');
      expect(painel.resumo).toContain('Pedido na loja: nº 107834');
      expect(painel.eventos[0].texto).toBe('Pedido nº 107834 criado na ERP Automatiza (banco de dados)');
    });

    it('o atendente monta, ajusta e fecha o pedido pelo painel; acompanha a situação e cancela antes da loja separar', async () => {
      await salvar({ ...CREDENCIAIS_BANCO, pedido_parceiro: 'K' });
      await sincronizar();
      await http().patch('/v1/loja/configuracoes').set('X-Loja-Chave', loja.chaveAdmin).send({ modoPedido: 'criar_pedido' });
      const atendente = { 'X-Loja-Chave': loja.chaveAtendimento, 'X-Kentro-Usuario-Nome': encodeURIComponent('Bruna') };

      const opcoes = await http().get('/v1/sessoes/opcoes-pedido').set(atendente);
      expect(opcoes.body).toMatchObject({ entrega: { habilitada: true }, retirada: { habilitada: false, lojas: [] }, pedidoNaLoja: true, pagamentoNaEntrega: true });

      // Sem link para o cliente: o carrinho do atendimento nasce com os itens escolhidos.
      const criada = await http().post('/v1/sessoes').set(atendente).send({ chatId: '301', nome: 'Ana Souza', telefone: '5538988887777', itens: [{ produtoId: '101', quantidade: 1 }] });
      const id = criada.body.id as string;
      const ajuste = await http().put(`/v1/sessoes/${id}/carrinho`).set(atendente).send({ itens: [{ produtoId: '101', quantidade: 3 }] });
      expect(ajuste.body.sessao.itens.map((i: { sku: string; quantidade: number }) => [i.sku, i.quantidade])).toEqual([['101', 3]]);

      const fechar = (corpo: object) => http().post(`/v1/sessoes/${id}/finalizar`).set(atendente).send({ tipo: 'entrega', entrega: ENTREGA, ...corpo });
      expect((await fechar({})).body.erro.mensagem).toBe('Escolha a forma de pagamento.');
      const r = await fechar({ pagamento: { forma: 'pix' } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'pedido_criado', pedido: { numero: '107834', acompanhar: true, cancelavel: true }, checkout: { pagamento: { forma: 'pix' } } });
      expect(r.body.eventos.map((e: { texto: string }) => e.texto)).toContain('Bruna finalizou o pedido pelo painel (entrega) — R$ 11,97');
      expect(tabelas.itens_pedido_ecommerce.map((i) => [i.Codigo_Mercadoria, i.itpeQuantidade])).toEqual([[101, 3]]);
      expect(tabelas.pedido_ecommerce[0]).toMatchObject({ filiCodigo: 7, peecValor_Total: 11.97, peecDescricao_Pagamento: 'PIX na entrega' });
      expect((await fechar({ pagamento: { forma: 'pix' } })).body.erro).toMatchObject({ codigo: 'PEDIDO_JA_ENVIADO', mensagem: 'Este pedido já foi finalizado.' });

      // O ERP transmitiu para a loja: o painel lê a situação.
      tabelas.pedido_ecommerce[0].Status_Transmissao = 'S';
      const situacao = await http().post(`/v1/sessoes/${id}/pedido/atualizar`).set(atendente);
      expect(situacao.body.pedido).toMatchObject({ status: 'ATIVO', descricao: 'Recebido pela loja', cancelavel: true });
      expect(situacao.body.resumo).toContain('Pedido na loja: nº 107834 (Recebido pela loja)');

      const cancelado = await http().post(`/v1/sessoes/${id}/pedido/cancelar`).set(atendente);
      expect(cancelado.status).toBe(200);
      expect(cancelado.body.pedido).toMatchObject({ status: 'CANCELADO', descricao: 'Cancelado', cancelavel: false });
      expect(cancelado.body.eventos[0].texto).toBe('Pedido nº 107834 cancelado na loja por Bruna');
      expect(tabelas.pedido_ecommerce[0]).toMatchObject({ Situacao: 'CANCELADO', peecUltimo_Evento: 'pedido_cancelado' });
    });

    it('a loja já está separando: o painel mostra a mudança e o cancelamento é recusado sem mexer no ERP', async () => {
      const token = await preparar();
      await finalizar(token, { pagamento: { forma: 'cartao' } });
      const sessaoId = (await http().get('/v1/sessoes/chat/300').set('X-Loja-Chave', loja.chaveAtendimento)).body.id;
      tabelas.pedido_ecommerce[0].Situacao = 'EM SEPARACAO';

      const situacao = await http().post(`/v1/sessoes/${sessaoId}/pedido/atualizar`).set('X-Loja-Chave', loja.chaveAtendimento);
      expect(situacao.body.pedido).toMatchObject({ status: 'EM SEPARACAO', descricao: 'Em separação', cancelavel: false });
      expect(situacao.body.eventos[0].texto).toBe('Pedido nº 107834 na loja: Em separação');

      const cancelar = await http().post(`/v1/sessoes/${sessaoId}/pedido/cancelar`).set('X-Loja-Chave', loja.chaveAtendimento);
      expect(cancelar.status).toBe(422);
      expect(cancelar.body.erro.mensagem).toBe('O pedido já está em separação na loja: o cancelamento precisa ser feito pela loja.');
      expect(tabelas.pedido_ecommerce[0].Situacao).toBe('EM SEPARACAO');
    });

    it('sem o código de parceiro, o pedido segue para o atendente e nada é gravado', async () => {
      const token = await preparar(CREDENCIAIS_BANCO);
      expect((await abrir(token)).body).toMatchObject({ pedidoNaLoja: false, pagamentoNaEntrega: false });
      const r = await finalizar(token, {});
      expect(r.body.status).toBe('finalizado');
      expect(tabelas).toEqual(tabelasVazias());
    });

    it('o ERP recusou: a finalização vale, nada fica pela metade e o atendente fecha a venda', async () => {
      const token = await preparar();
      banco = { falharEm: 'INSERT INTO itens_pedido_ecommerce_pagamento' };
      const r = await finalizar(token, { pagamento: { forma: 'pix' } });
      expect(r.body.status).toBe('finalizado');
      expect(tabelas).toEqual(tabelasVazias());
      const painel = (await http().get('/v1/sessoes/chat/300').set('X-Loja-Chave', loja.chaveAtendimento)).body;
      expect(painel.eventos[0].texto).toBe('Não foi possível criar o pedido na loja (O banco de dados da loja recusou os dados do pedido.) O atendente fecha a venda.');
    });
  });

  it('rodada automática: sincroniza a cópia vencida e respeita a validade (também depois de falha)', async () => {
    await salvar();
    const sinc = app.get(SincronizacaoService);
    const agora = Date.now();
    await sinc.rodada(agora);
    expect((await estado()).body.total).toBe(5);

    abertos.length = 0;
    await sinc.rodada(agora + 5 * 60_000); // ainda vale (15 min)
    expect(abertos).toEqual([]);

    banco = { fora: true };
    await sinc.rodada(agora + 16 * 60_000); // vencida: tenta e falha sem derrubar a rodada
    expect((await estado()).body.ultimoErro).toBeTruthy();
    abertos.length = 0;
    await sinc.rodada(Date.now() + 5 * 60_000); // espera o intervalo depois da falha
    expect(abertos).toEqual([]);

    await prisma.loja.update({ where: { id: loja.lojaId }, data: { status: 'bloqueada' } });
    banco = {};
    await sinc.rodada(Date.now() + 60 * 60_000); // loja bloqueada fica de fora
    expect(abertos).toEqual([]);
  });
});
