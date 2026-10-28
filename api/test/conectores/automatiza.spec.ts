import {
  categoriasDaView,
  conectorAutomatiza,
  idCategoria,
  produtoDaView,
  TABELA_ITENS,
  TABELA_PAGAMENTO,
  TABELA_PEDIDO,
  textoBanco,
  titulo,
} from '../../src/conectores/automatiza/automatiza.conector';
import { ClienteBanco, conferirGravacao } from '../../src/conectores/nucleo/banco';
import { CatalogoLocal, CtxConector } from '../../src/conectores/nucleo/conector';
import { CredencialInvalida, PlataformaIndisponivel, RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { PedidoParaCriar } from '../../src/contratos/modelo';
import { bancoEmMemoria, BancoMemoria, CREDENCIAIS_BANCO, LINHAS_VIEW, tabelasVazias } from './banco-memoria';
import { copiaEmMemoria } from './catalogo-memoria';

const ctx = (banco?: ClienteBanco, catalogoLocal?: CatalogoLocal): CtxConector => ({
  lojaId: 'aut',
  credenciais: CREDENCIAIS_BANCO,
  http: { requisitar: () => Promise.reject(new Error('o conector do Automatiza não faz HTTP')) },
  salvarCredenciais: async () => undefined,
  ...(banco ? { banco } : {}),
  ...(catalogoLocal ? { catalogoLocal } : {}),
});

describe('conector ERP Automatiza (views do MySQL)', () => {
  it('normaliza a linha da view: preço de delivery, preço de tabela maior vira "de", EAN na busca', () => {
    expect(produtoDaView(LINHAS_VIEW[0])).toEqual({
      produto: {
        id: '101',
        sku: '101',
        nome: 'SABONETE NEUTRO 90G',
        descricao: 'Laboratório: LABORATORIO TESTE LTDA',
        imagens: [],
        preco: 3.99,
        precoDe: 4.99,
        unidade: 'UN',
        estoque: 5,
        disponivel: true,
        categoriaIds: [idCategoria('HIGIENE E BELEZA')],
        variacoes: [],
      },
      termos: '7890000000101',
      codigoBarras: '7890000000101',
    });
    expect(produtoDaView(LINHAS_VIEW[1])!.produto.precoDe).toBeUndefined(); // mesmo preço: sem "de"
  });

  it('deixa de fora controlado, fora de linha, sem estoque, sem preço e uso interno (grupo ou subgrupo)', () => {
    const fora = LINHAS_VIEW.filter((l) => Number(l.codigo_mercadoria) >= 200);
    expect(fora.map(produtoDaView)).toEqual(fora.map(() => null));
    expect(produtoDaView({ ...LINHAS_VIEW[0], tipo_controle: 'Psicotropico' })).toBeNull(); // mesmo sem a marca de controle
    expect(produtoDaView({ ...LINHAS_VIEW[0], codigo_mercadoria: 'abc' })).toBeNull();
  });

  it('o mesmo subgrupo em grupos diferentes vira uma categoria, com nome legível', () => {
    expect(idCategoria('DERMOCOSMETICOS')).toBe(idCategoria(' dermocosméticos  '));
    expect(titulo('HIGIENE E BELEZA')).toBe('Higiene e Beleza');
    expect(titulo('GENERICO_OTC')).toBe('Generico OTC');
    const usadas = new Set([idCategoria('DERMOCOSMETICOS'), idCategoria('GENERICO_OTC')]);
    expect(categoriasDaView(LINHAS_VIEW, usadas)).toEqual([
      { id: idCategoria('DERMOCOSMETICOS'), nome: 'Dermocosmeticos' },
      { id: idCategoria('GENERICO_OTC'), nome: 'Generico OTC' },
    ]);
  });

  it('lê o catálogo inteiro numa consulta, com o filtro por parâmetro e tempo maior', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    const catalogo = await conectorAutomatiza.lerCatalogoCompleto!(ctx(banco));
    expect(catalogo.produtos.map((p) => p.produto.id)).toEqual(['101', '102', '103', '104', '105']);
    expect(catalogo.categorias.map((c) => c.nome)).toEqual(['Dermocosmeticos', 'Generico OTC', 'Higiene e Beleza']);
    expect(banco.consultas).toEqual([{ operacao: 'sincronizar_catalogo', sql: expect.stringContaining('FROM view_ecommerce_delivery_produtos'), parametros: ['ATIVO'] }]);
  });

  it('teste de conexão: confere a filial no banco e pede a sincronização até ela acontecer', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    expect(await conectorAutomatiza.testarConexao(ctx(banco, copiaEmMemoria([], [], null)))).toEqual({
      ok: false,
      mensagem: 'Banco conectado (FARMACIA TESTE - LOJA07), mas os produtos ainda não foram sincronizados. Clique em "Sincronizar agora".',
    });
    const produtos = LINHAS_VIEW.slice(0, 2).map((l) => produtoDaView(l)!);
    expect(await conectorAutomatiza.testarConexao(ctx(banco, copiaEmMemoria(produtos, [])))).toEqual({ ok: true, nomeLoja: 'FARMACIA TESTE - LOJA07 (2 produtos)' });
    expect((await conectorAutomatiza.testarConexao(ctx(bancoEmMemoria(CREDENCIAIS_BANCO, { filial: null }), copiaEmMemoria(produtos, [])))).ok).toBe(false);
  });

  it('teste de conexão leva os erros do banco: senha errada e banco fora do ar', async () => {
    const copia = copiaEmMemoria([], []);
    await expect(conectorAutomatiza.testarConexao(ctx(bancoEmMemoria({ ...CREDENCIAIS_BANCO, senha: 'x' }), copia))).rejects.toBeInstanceOf(CredencialInvalida);
    await expect(conectorAutomatiza.testarConexao(ctx(bancoEmMemoria(CREDENCIAIS_BANCO, { fora: true }), copia))).rejects.toBeInstanceOf(PlataformaIndisponivel);
  });

  it('busca pelo código de barras e lê o produto pela cópia, sem ir ao banco', async () => {
    const banco: BancoMemoria = bancoEmMemoria(CREDENCIAIS_BANCO);
    const produtos = LINHAS_VIEW.map(produtoDaView).filter((p) => !!p).map((p) => p!);
    const c = ctx(banco, copiaEmMemoria(produtos, []));
    expect((await conectorAutomatiza.listarProdutos(c, { busca: '7890000000104', pagina: 1, porPagina: 10 })).itens.map((p) => p.nome)).toEqual(['PROTETOR SOLAR FPS50 120ML']);
    expect((await conectorAutomatiza.obterProduto(c, '103'))!.nome).toBe('DIPIRONA 500MG 10 COMPRIMIDOS');
    expect(banco.consultas).toEqual([]);
  });

  it('valida as credenciais ao salvar: endereço público, porta e nome do banco', () => {
    expect(conectorAutomatiza.validarCredenciais!(CREDENCIAIS_BANCO)).toBeNull();
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, host: '192.168.0.10' })).toMatch(/endereço público/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, host: 'localhost' })).toMatch(/endereço público/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, host: 'http://banco.teste' })).toMatch(/sem http/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, porta: '70000' })).toMatch(/porta/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, banco: 'x; drop' })).toMatch(/nome do banco/);
    // Trocar o servidor ou a porta exige digitar a senha de novo.
    // Um destino por senha: a do banco vai ao servidor do banco; a do FTP, ao FTP.
    expect(conectorAutomatiza.destino!(CREDENCIAIS_BANCO)).toEqual({ senha: 'banco.erp.teste:3306', ftp_senha: '' });
    expect(conectorAutomatiza.destino!({ ...CREDENCIAIS_BANCO, porta: '', ftp_host: 'arquivos.teste', ftp_porta: '6785' })).toEqual({
      senha: 'banco.erp.teste:3306',
      ftp_senha: 'arquivos.teste:6785',
    });
    // FTP opcional, mas se vier precisa estar completo.
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, ftp_host: 'arquivos.teste' })).toMatch(/usuário e a senha do FTP/);
  });

  it('sem o banco ou a cópia no contexto, recusa em vez de quebrar', async () => {
    await expect(conectorAutomatiza.lerCatalogoCompleto!(ctx())).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
    await expect(conectorAutomatiza.listarCategorias(ctx())).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
  });
});

describe('conector ERP Automatiza: pedido gravado no banco', () => {
  const COM_PEDIDO = { ...CREDENCIAIS_BANCO, pedido_parceiro: 'K' };
  const comPedido = (banco: ClienteBanco, credenciais: Record<string, string> = COM_PEDIDO): CtxConector => ({ ...ctx(banco), credenciais });
  const PEDIDO: PedidoParaCriar = {
    cliente: { nome: 'Ana Souza 😀', telefone: '5538988887777', documento: '123.456.789-09' },
    entrega: {
      tipo: 'entrega',
      endereco: { cep: '39400-000', estado: 'mg', cidade: 'Curvelo', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: 'Apto 2', referencia: 'Perto da praça' },
    },
    itens: [
      { produtoId: '101', sku: '101', nome: 'SABONETE NEUTRO 90G', quantidade: 2, precoUnitario: 3.99 },
      { produtoId: '103', sku: '103', nome: 'DIPIRONA 500MG 10 COMPRIMIDOS', quantidade: 1, precoUnitario: 6.9 },
    ],
    frete: { titulo: 'Frete', valor: 5 },
    pagamento: { forma: 'dinheiro', trocoPara: 50 },
    observacoes: 'Interfone quebrado',
    referenciaExterna: 'sessao-0001',
  };

  it('grava cabeçalho, itens e pagamento numa transação, na filial logada, para a loja receber (transmissão N)', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    expect(await conectorAutomatiza.criarPedido!(comPedido(banco), PEDIDO)).toEqual({ idExterno: '7-107834', numero: '107834', status: 'ATIVO' });

    const [pedido] = banco.tabelas[TABELA_PEDIDO];
    expect(pedido).toMatchObject({
      Codigo: 107834,
      filiCodigo: 7,
      peecCodigo_Ecommerce: 'sessao-0001',
      peecParceiro: 'K',
      peecCanal: 'KENTRO',
      Codigo_Parceiro_Ecommerce: 0,
      peecValor_Total: 19.88, // 2 × 3,99 + 6,90 + 5,00 de frete
      peecValor_Frete: 5,
      peecValor_Desconto: 0,
      peecNome_Cliente: 'Ana Souza', // sem emoji: a coluna é utf8 de 3 bytes
      peecTelefone_Cliente: '5538988887777',
      peecDocumento_Cliente: '12345678909',
      peecCep_Entrega: '39400000',
      peecUF_Entrega: 'MG',
      peecLogradouro_Entrega: 'Rua A',
      peecReferencia_Entrega: 'Perto da praça',
      peecIdentificacao_Pagamento: '1', // DINHEIRO na view do ERP
      peecDescricao_Pagamento: 'Dinheiro na entrega (troco para R$ 50,00)',
      peecPagamento_Realizado: 0,
      peecValor_Parcela_Pagamento: 19.88,
      peecTroco_Pagamento: 30.12,
      peecTransporte_Metodo: 'Entrega',
      peecObservacoes_Entrega: 'Troco para R$ 50,00. Interfone quebrado',
      Situacao: 'ATIVO',
      Status_Transmissao: 'N',
      peecData_Cadastro: '<NOW>',
      peecData_Entrega: '<CURDATE>',
    });
    expect(banco.tabelas[TABELA_ITENS]).toEqual([
      { Codigo_Pedido_Ecommerce: 107834, filiCodigo_Pedido_Ecommerce: 7, Codigo_Mercadoria: 101, itpeDescricao_Mercadoria: 'SABONETE NEUTRO 90G', itpeQuantidade: 2, itpeValor: 3.99 },
      { Codigo_Pedido_Ecommerce: 107834, filiCodigo_Pedido_Ecommerce: 7, Codigo_Mercadoria: 103, itpeDescricao_Mercadoria: 'DIPIRONA 500MG 10 COMPRIMIDOS', itpeQuantidade: 1, itpeValor: 6.9 },
    ]);
    expect(banco.tabelas[TABELA_PAGAMENTO]).toEqual([
      expect.objectContaining({ Codigo_Pedido_Ecommerce: 107834, filiCodigo_Pedido_Ecommerce: 7, ipepPagamento_Realizado: 0, ipepCodigo_Condicao_Pagamento: '1', ipepForma_Pagamento: 'Dinheiro', ipepValor_Total: 19.88 }),
    ]);
    expect(banco.gravacoes.map((g) => g.sql.split('(')[0].trim())).toEqual([
      'INSERT INTO pedido_ecommerce',
      'INSERT INTO itens_pedido_ecommerce',
      'INSERT INTO itens_pedido_ecommerce_pagamento',
      'COMMIT',
    ]);
    // Valores sempre por parâmetro: nada do cliente entra no texto do SQL.
    expect(banco.gravacoes.some((g) => g.sql.includes('Ana') || g.sql.includes('Rua A'))).toBe(false);
  });

  it('cada loja grava na sua filial: duas filiais no mesmo servidor dividem as tabelas, não os pedidos', async () => {
    const tabelas = tabelasVazias();
    const curvelo = bancoEmMemoria(CREDENCIAIS_BANCO, { tabelas, filial: { codigo_filial: 8, filial_fantasia: 'LOJA08' } });
    const centro = bancoEmMemoria(CREDENCIAIS_BANCO, { tabelas, filial: { codigo_filial: 3, filial_fantasia: 'LOJA03' } });
    const a = await conectorAutomatiza.criarPedido!(comPedido(curvelo), PEDIDO);
    // Mesmo id de sessão em outra filial não é o mesmo pedido.
    const b = await conectorAutomatiza.criarPedido!(comPedido(centro), PEDIDO);
    expect([a.idExterno, b.idExterno]).toEqual(['8-107834', '3-107835']);
    expect(tabelas[TABELA_PEDIDO].map((p) => p.filiCodigo)).toEqual([8, 3]);
    expect(tabelas[TABELA_ITENS].map((i) => [i.filiCodigo_Pedido_Ecommerce, i.Codigo_Pedido_Ecommerce])).toEqual([
      [8, 107834],
      [8, 107834],
      [3, 107835],
      [3, 107835],
    ]);
    expect(tabelas[TABELA_PAGAMENTO].map((g) => g.filiCodigo_Pedido_Ecommerce)).toEqual([8, 3]);
  });

  it('repetir o mesmo pedido (mesma sessão) devolve o já gravado, sem duplicar', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    const primeiro = await conectorAutomatiza.criarPedido!(comPedido(banco), PEDIDO);
    expect(await conectorAutomatiza.criarPedido!(comPedido(banco), PEDIDO)).toEqual(primeiro);
    expect(banco.tabelas[TABELA_PEDIDO]).toHaveLength(1);
    expect(banco.tabelas[TABELA_ITENS]).toHaveLength(2);
  });

  it('erro no meio (pagamento recusado pelo banco): desfaz tudo, nada fica gravado', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO, { falharEm: 'INSERT INTO itens_pedido_ecommerce_pagamento' });
    await expect(conectorAutomatiza.criarPedido!(comPedido(banco), PEDIDO)).rejects.toThrow('O banco de dados da loja recusou os dados do pedido.');
    expect(banco.tabelas).toEqual(tabelasVazias());
    expect(banco.gravacoes.at(-1)!.sql).toBe('ROLLBACK');
  });

  it('usuário sem filial ou forma de pagamento que o ERP não tem: recusa sem gravar', async () => {
    const semFilial = bancoEmMemoria(CREDENCIAIS_BANCO, { filial: null });
    await expect(conectorAutomatiza.criarPedido!(comPedido(semFilial), PEDIDO)).rejects.toThrow(/não está ligado a nenhuma filial/);
    expect(semFilial.gravacoes.filter((g) => g.sql.startsWith('INSERT'))).toEqual([]);

    const semPix = bancoEmMemoria(CREDENCIAIS_BANCO, { condicoes: [{ codigo_pagamento: 1, descricao: 'DINHEIRO' }] });
    await expect(conectorAutomatiza.criarPedido!(comPedido(semPix), { ...PEDIDO, pagamento: { forma: 'pix' } })).rejects.toThrow('A forma de pagamento PIX não está cadastrada no ERP.');
    expect(semPix.tabelas).toEqual(tabelasVazias());
  });

  it('retirada, cartão com acento no ERP e código de parceiro próprio: endereço vazio e transporte de retirada', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO, { condicoes: [{ codigo_pagamento: 12, descricao: 'Cartão de débito' }] });
    const credenciais = { ...COM_PEDIDO, pedido_canal: 'Kentro Shop', pedido_codigo_parceiro: '9' };
    await conectorAutomatiza.criarPedido!(comPedido(banco, credenciais), {
      ...PEDIDO,
      entrega: { tipo: 'retirada', lojaRetiradaId: 'l1' },
      frete: undefined,
      pagamento: { forma: 'cartao', trocoPara: 100 }, // troco só vale no dinheiro
    });
    expect(banco.tabelas[TABELA_PEDIDO][0]).toMatchObject({
      peecCanal: 'Kentro Shop',
      Codigo_Parceiro_Ecommerce: 9,
      peecValor_Total: 14.88,
      peecCep_Entrega: '',
      peecLogradouro_Entrega: '',
      peecTransporte_Metodo: 'Retirada na Loja',
      peecIdentificacao_Pagamento: '12',
      peecDescricao_Pagamento: 'Cartão na retirada',
      peecTroco_Pagamento: 0,
    });
  });

  it('sem o código de parceiro: não cria pedido (vai para o atendente) e não abre o banco', async () => {
    expect(conectorAutomatiza.criaPedido!(CREDENCIAIS_BANCO)).toBe(false);
    expect(conectorAutomatiza.criaPedido!(COM_PEDIDO)).toBe(true);
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    await expect(conectorAutomatiza.criarPedido!(comPedido(banco, CREDENCIAIS_BANCO), PEDIDO)).rejects.toThrow(/não estão configurados/);
    expect(banco.consultas).toEqual([]);
    expect(conectorAutomatiza.validarCredenciais!({ ...COM_PEDIDO, pedido_parceiro: "K'; DROP" })).toMatch(/código de parceiro/);
    expect(conectorAutomatiza.validarCredenciais!({ ...COM_PEDIDO, pedido_codigo_parceiro: 'quatro' })).toMatch(/número do parceiro/);
  });

  it('confere o pedido antes de abrir o banco: produto sem código do ERP, sem pagamento ou sem itens', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    const tentar = (p: Partial<PedidoParaCriar>) => conectorAutomatiza.criarPedido!(comPedido(banco), { ...PEDIDO, ...p });
    await expect(tentar({ itens: [{ produtoId: 'abc', sku: 'abc', quantidade: 1, precoUnitario: 2 }] })).rejects.toThrow(/código de mercadoria/);
    await expect(tentar({ pagamento: undefined })).rejects.toThrow(/forma de pagamento/);
    await expect(tentar({ itens: [] })).rejects.toThrow(/sem produtos/);
    expect(banco.consultas).toEqual([]);
  });

  it('situação do pedido: lê só na filial logada e do próprio parceiro', async () => {
    const tabelas = tabelasVazias();
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO, { tabelas });
    const { idExterno } = await conectorAutomatiza.criarPedido!(comPedido(banco), PEDIDO);
    expect(await conectorAutomatiza.situacaoPedido!(comPedido(banco), idExterno)).toEqual({ status: 'ATIVO', descricao: 'Enviado, aguardando a loja receber', cancelavel: true });

    tabelas[TABELA_PEDIDO][0].Status_Transmissao = 'S'; // o ERP transmitiu para a loja
    expect((await conectorAutomatiza.situacaoPedido!(comPedido(banco), idExterno)).descricao).toBe('Recebido pela loja');
    tabelas[TABELA_PEDIDO][0].Situacao = 'EM SEPARACAO';
    expect(await conectorAutomatiza.situacaoPedido!(comPedido(banco), idExterno)).toEqual({ status: 'EM SEPARACAO', descricao: 'Em separação', cancelavel: false });

    // Outra filial (outro usuário de banco) e outro parceiro não enxergam o pedido.
    const outraFilial = bancoEmMemoria(CREDENCIAIS_BANCO, { tabelas, filial: { codigo_filial: 3 } });
    await expect(conectorAutomatiza.situacaoPedido!(comPedido(outraFilial), idExterno)).rejects.toThrow('O pedido não foi encontrado no ERP desta filial.');
    await expect(conectorAutomatiza.situacaoPedido!(comPedido(banco, { ...COM_PEDIDO, pedido_parceiro: 'Z' }), idExterno)).rejects.toThrow(/não foi encontrado/);
    await expect(conectorAutomatiza.situacaoPedido!(comPedido(banco), "7-1 OR 1=1")).rejects.toThrow('Pedido do ERP não reconhecido.');
  });

  it('cancelar: UPDATE só do cabeçalho, enquanto ATIVO; depois de separar, recusa e não mexe', async () => {
    const tabelas = tabelasVazias();
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO, { tabelas });
    const a = await conectorAutomatiza.criarPedido!(comPedido(banco), PEDIDO);
    const b = await conectorAutomatiza.criarPedido!(comPedido(banco), { ...PEDIDO, referenciaExterna: 'sessao-0002' });

    expect(await conectorAutomatiza.cancelarPedido!(comPedido(banco), a.idExterno)).toEqual({ status: 'CANCELADO', descricao: 'Cancelado', cancelavel: false });
    expect(tabelas[TABELA_PEDIDO].map((p) => [p.Codigo, p.Situacao, p.peecUltimo_Evento])).toEqual([
      [107834, 'CANCELADO', 'pedido_cancelado'],
      [107835, 'ATIVO', 'pedido_criado'], // o outro pedido não muda
    ]);
    expect(tabelas[TABELA_PEDIDO][0].peecData_Atualizacao).toBe('<NOW()>');
    const update = banco.gravacoes.find((g) => g.sql.trim().startsWith('UPDATE'))!;
    expect(update.parametros).toEqual([107834, 7, 'K']);
    // Cancelar de novo não é erro: já está cancelado.
    expect((await conectorAutomatiza.cancelarPedido!(comPedido(banco), a.idExterno)).status).toBe('CANCELADO');

    tabelas[TABELA_PEDIDO][1].Situacao = 'EM SEPARACAO';
    await expect(conectorAutomatiza.cancelarPedido!(comPedido(banco), b.idExterno)).rejects.toThrow(
      'O pedido já está em separação na loja: o cancelamento precisa ser feito pela loja.',
    );
    expect(tabelas[TABELA_PEDIDO][1].Situacao).toBe('EM SEPARACAO');
    expect(banco.gravacoes.at(-1)!.sql).toBe('ROLLBACK');

    // Pedido de outra filial: nem lê.
    const outraFilial = bancoEmMemoria(CREDENCIAIS_BANCO, { tabelas, filial: { codigo_filial: 3 } });
    tabelas[TABELA_PEDIDO][1].Situacao = 'ATIVO';
    await expect(conectorAutomatiza.cancelarPedido!(comPedido(outraFilial), b.idExterno)).rejects.toThrow(/não foi encontrado/);
    expect(tabelas[TABELA_PEDIDO][1].Situacao).toBe('ATIVO');
  });

  it('a gravação só aceita INSERT/UPDATE nas tabelas do pedido', () => {
    expect(() => conferirGravacao('DELETE FROM pedido_ecommerce', ['pedido_ecommerce'])).toThrow(RecusadoPelaPlataforma);
    expect(() => conferirGravacao('INSERT INTO produtos (a) VALUES (?)', ['pedido_ecommerce'])).toThrow(RecusadoPelaPlataforma);
    expect(() => conferirGravacao('UPDATE `pedido_ecommerce` SET Situacao = ?', ['pedido_ecommerce'])).not.toThrow();
    expect(textoBanco('  Olá\n😀 mundo  ', 6)).toBe('Olá mu');
  });
});
