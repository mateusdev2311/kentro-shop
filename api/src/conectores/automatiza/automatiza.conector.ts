import { createHash } from 'node:crypto';
import { Categoria, FormaPagamento, PedidoCriado, PedidoParaCriar, Produto, SituacaoPedido } from '../../contratos/modelo';
import { camposMysql, ClienteBanco, destinoBanco, Linha, lerCredenciaisBanco, TransacaoBanco } from '../nucleo/banco';
import { CampoCredencial, CatalogoLocal, Conector, CtxConector, ProdutoSincronizado } from '../nucleo/conector';
import { RecusadoPelaPlataforma } from '../nucleo/erros';
import { camposFtpFotos, destinoFtp, lerCredenciaisFtp } from '../nucleo/ftp';

// ERP Automatiza (farmácias): o ERP libera views "view_ecommerce_delivery_*" num MySQL, para um usuário
// ligado a uma filial (as views já vêm filtradas pela filial logada). Ler a view de produtos custa alguns
// segundos por consulta, qualquer que seja o filtro: a API copia o catálogo de tempos em tempos e o
// conector lê a cópia.
// Pedido: entra nas tabelas pedido_ecommerce, itens e pagamento (as mesmas do iFood e dos marketplaces), numa
// transação. Essas tabelas NÃO vêm filtradas: têm os pedidos de todas as filiais. A filial do pedido é sempre a
// filial logada (a mesma do catálogo e do estoque), lida na hora; nunca vem da tela nem do cliente.

export const VIEW_PRODUTOS = 'view_ecommerce_delivery_produtos';
export const VIEW_FILIAL_LOGADA = 'view_ecommerce_delivery_filial_logada';
export const VIEW_CONDICOES_PAGAMENTO = 'view_ecommerce_delivery_condicao_pamento';
export const TABELA_PEDIDO = 'pedido_ecommerce';
export const TABELA_ITENS = 'itens_pedido_ecommerce';
export const TABELA_PAGAMENTO = 'itens_pedido_ecommerce_pagamento';
const TABELAS_DO_PEDIDO = [TABELA_PEDIDO, TABELA_ITENS, TABELA_PAGAMENTO] as const;
const BANCO_PADRAO = 'automatiza';
const CANAL_PADRAO = 'KENTRO';
/** Como o ERP marca o pedido novo (o iFood usa o mesmo campo para os eventos seguintes). */
const EVENTO_NOVO = 'pedido_criado';
/** Proteção de memória: a leitura traz o catálogo vendável inteiro de uma vez. */
export const MAX_PRODUTOS = 100_000;

/** Grupos e subgrupos de uso interno do ERP, que não são vendidos ao cliente (ex.: taxa de entrega). */
const GRUPOS_FORA_DA_VENDA = new Set(['USO E CONSUMO', 'ATIVO IMOBILIZADO', 'ENTREGAS', 'MATERIA PRIMA', 'CONSUMO', 'ATUALIZAR']);
const SIGLAS = new Set(['OTC', 'RX', 'PBM', 'PET', 'AC', 'UV']);
const MINUSCULAS = new Set(['e', 'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em']);

const texto = (v: unknown): string => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const numero = (v: unknown): number => {
  const n = Number(texto(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const centavos = (n: number): number => Math.round(n * 100) / 100;
const chave = (s: string): string =>
  texto(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

/** "HIGIENE E BELEZA" -> "Higiene e Beleza"; "ETICO_RX" -> "Etico RX". */
export function titulo(nome: string): string {
  return texto(nome.replace(/_/g, ' '))
    .toLowerCase()
    .split(' ')
    .map((p, i) => (SIGLAS.has(p.toUpperCase()) ? p.toUpperCase() : i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** O mesmo subgrupo em grupos diferentes (ex.: Dermocosméticos) vira uma categoria só. Id estável pelo nome. */
export function idCategoria(subgrupo: string): string {
  return `sg-${createHash('sha1').update(chave(subgrupo)).digest('hex').slice(0, 12)}`;
}

/**
 * Linha da view de produtos no formato do contrato. Fica de fora (null): inativo, sem estoque, sem preço de
 * delivery, grupo de uso interno e controlado (antibiótico e psicotrópico exigem a retenção da receita).
 */
export function produtoDaView(l: Linha): ProdutoSincronizado | null {
  const id = texto(l.codigo_mercadoria);
  const nome = texto(l.descricao).slice(0, 200);
  if (!/^\d{1,18}$/.test(id) || !nome) return null;
  if (chave(texto(l.situacao)) !== 'ATIVO') return null;
  if (texto(l.cotrole_especial).toLowerCase() === 'true' || texto(l.tipo_controle)) return null;
  if (GRUPOS_FORA_DA_VENDA.has(chave(texto(l.grupo_principal))) || GRUPOS_FORA_DA_VENDA.has(chave(texto(l.subgrupo)))) return null;

  const preco = centavos(numero(l.preco_venda_delivery));
  const estoque = Math.floor(numero(l.estoque));
  if (preco <= 0 || estoque <= 0) return null;
  const precoTabela = centavos(numero(l.preco_venda));
  const laboratorio = texto(l.laboratorio);
  const subgrupo = texto(l.subgrupo);
  const ean = texto(l.EAN).replace(/\D/g, '');

  const produto: Produto = {
    id,
    // O código da mercadoria é o que o ERP usa para lançar o pedido.
    sku: id,
    nome,
    descricao: laboratorio ? `Laboratório: ${laboratorio}` : '',
    imagens: [],
    preco,
    ...(precoTabela > preco ? { precoDe: precoTabela } : {}),
    unidade: 'UN',
    estoque,
    disponivel: true,
    categoriaIds: subgrupo ? [idCategoria(subgrupo)] : [],
    variacoes: [],
  };
  return { produto, ...(ean ? { termos: ean, codigoBarras: ean } : {}) };
}

/** Categorias dos produtos que entraram, em ordem alfabética. */
export function categoriasDaView(linhas: Linha[], usadas: Set<string>): Categoria[] {
  const porId = new Map<string, Categoria>();
  for (const l of linhas) {
    const subgrupo = texto(l.subgrupo);
    const id = subgrupo ? idCategoria(subgrupo) : '';
    if (id && usadas.has(id) && !porId.has(id)) porId.set(id, { id, nome: titulo(subgrupo).slice(0, 80) });
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Campos do pedido no ERP. Sem o código de parceiro, o pedido segue para o atendente (como antes). */
export function camposPedido(): CampoCredencial[] {
  return [
    {
      chave: 'pedido_parceiro',
      rotulo: 'Pedidos: código de parceiro no ERP',
      tipo: 'texto',
      obrigatorio: false,
      ajuda: 'Opcional. O código que o Automatiza usa para os pedidos do Kentro Shop (campo peecParceiro), combinado com o fornecedor do ERP. Vazio = o pedido não vai para o ERP; o atendente fecha a venda.',
    },
    { chave: 'pedido_canal', rotulo: 'Pedidos: canal', tipo: 'texto', obrigatorio: false, ajuda: `Vazio = ${CANAL_PADRAO}.` },
    { chave: 'pedido_codigo_parceiro', rotulo: 'Pedidos: número do parceiro', tipo: 'texto', obrigatorio: false, ajuda: 'Código_Parceiro_Ecommerce, se o fornecedor do ERP pedir. Vazio = 0.' },
  ];
}

export interface ConfigPedido {
  parceiro: string;
  canal: string;
  codigoParceiro: number;
}

/** Configuração do pedido conferida; null = sem código de parceiro (não grava); texto = o que está errado. */
export function lerConfigPedido(c: Record<string, string>): ConfigPedido | null | string {
  const parceiro = (c.pedido_parceiro ?? '').trim();
  const canal = (c.pedido_canal ?? '').trim() || CANAL_PADRAO;
  const numero = (c.pedido_codigo_parceiro ?? '').trim();
  if (!parceiro) return null;
  if (!/^[A-Za-z0-9_-]{1,35}$/.test(parceiro)) return 'O código de parceiro do ERP só pode ter letras, números, _ e - (até 35).';
  if (!/^[A-Za-z0-9 _.-]{1,100}$/.test(canal)) return 'O canal do pedido só pode ter letras, números, espaço, _, . e - (até 100).';
  if (numero && !/^\d{1,9}$/.test(numero)) return 'O número do parceiro precisa ser um número inteiro.';
  return { parceiro, canal, codigoParceiro: numero ? Number(numero) : 0 };
}

/** Texto para coluna utf8 (3 bytes) do MySQL: sem emoji, sem quebra de linha, no tamanho da coluna. */
export function textoBanco(valor: unknown, max: number): string {
  return texto(String(valor ?? '').replace(/[\u{10000}-\u{10FFFF}]/gu, '')).slice(0, max);
}

const digitos = (valor: unknown, max: number): string => String(valor ?? '').replace(/\D/g, '').slice(-max);

/** Como o ERP chama cada forma na view de condições de pagamento. */
const CONDICAO_DA_FORMA: Record<FormaPagamento, (descricao: string) => boolean> = {
  dinheiro: (d) => d === 'DINHEIRO',
  cartao: (d) => d.startsWith('CARTAO'),
  pix: (d) => d === 'PIX',
};
const NOME_DA_FORMA: Record<FormaPagamento, string> = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' };

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

/** Valores do pedido conferidos antes de abrir a transação (nada vai ao banco se algo estiver errado). */
export function conferirPedido(pedido: PedidoParaCriar): { itens: { codigo: number; nome: string; quantidade: number; preco: number }[]; frete: number; desconto: number; total: number } {
  if (!pedido.itens.length) throw new RecusadoPelaPlataforma('O pedido está sem produtos.');
  if (!pedido.pagamento) throw new RecusadoPelaPlataforma('O pedido está sem a forma de pagamento.');
  const itens = pedido.itens.map((i) => {
    const codigo = String(i.sku || i.produtoId).trim();
    if (!/^\d{1,9}$/.test(codigo)) throw new RecusadoPelaPlataforma('Um produto do pedido não tem código de mercadoria do ERP.');
    if (!Number.isInteger(i.quantidade) || i.quantidade <= 0) throw new RecusadoPelaPlataforma('Quantidade inválida no pedido.');
    if (!(i.precoUnitario > 0)) throw new RecusadoPelaPlataforma('Um produto do pedido está sem preço.');
    return { codigo: Number(codigo), nome: textoBanco(i.nome, 200), quantidade: i.quantidade, preco: centavos(i.precoUnitario) };
  });
  const frete = centavos(Math.max(0, pedido.frete?.valor ?? 0));
  const desconto = centavos(Math.max(0, pedido.desconto?.valor ?? 0));
  const total = centavos(itens.reduce((s, i) => s + i.preco * i.quantidade, 0) + frete - desconto);
  if (!(total > 0)) throw new RecusadoPelaPlataforma('O total do pedido precisa ser maior que zero.');
  return { itens, frete, desconto, total };
}

/** Grava o pedido na filial logada. Repetir com a mesma referência devolve o pedido já gravado. */
async function gravarPedido(tx: TransacaoBanco, config: ConfigPedido, pedido: PedidoParaCriar): Promise<PedidoCriado> {
  const [filial] = await tx.consultar(`SELECT codigo_filial FROM ${VIEW_FILIAL_LOGADA} LIMIT 1`);
  const codigoFilial = Number(filial?.codigo_filial);
  if (!Number.isInteger(codigoFilial) || codigoFilial <= 0) {
    throw new RecusadoPelaPlataforma('O usuário do banco não está ligado a nenhuma filial. Peça ao responsável pelo ERP para configurar a filial desse usuário.');
  }
  const criado = (codigo: unknown, situacao: unknown): PedidoCriado => ({
    idExterno: `${codigoFilial}-${texto(codigo)}`,
    numero: texto(codigo),
    status: texto(situacao) || 'ATIVO',
  });

  const referencia = textoBanco(pedido.referenciaExterna, 100);
  const [existente] = await tx.consultar(
    `SELECT Codigo, Situacao FROM ${TABELA_PEDIDO} WHERE peecCodigo_Ecommerce = ? AND peecCanal = ? AND peecParceiro = ? AND filiCodigo = ? LIMIT 1`,
    [referencia, config.canal, config.parceiro, codigoFilial],
  );
  if (existente) return criado(existente.Codigo, existente.Situacao);

  const { itens, frete, desconto, total } = conferirPedido(pedido);
  const pagamento = pedido.pagamento!;
  const condicoes = await tx.consultar(`SELECT codigo_pagamento, descricao FROM ${VIEW_CONDICOES_PAGAMENTO}`);
  const condicao = condicoes.find((c) => CONDICAO_DA_FORMA[pagamento.forma](chave(texto(c.descricao))));
  if (!condicao) throw new RecusadoPelaPlataforma(`A forma de pagamento ${NOME_DA_FORMA[pagamento.forma]} não está cadastrada no ERP.`);
  const codigoCondicao = textoBanco(condicao.codigo_pagamento, 36);
  const trocoPara = pagamento.forma === 'dinheiro' && pagamento.trocoPara && pagamento.trocoPara > total ? centavos(pagamento.trocoPara) : 0;
  const forma = NOME_DA_FORMA[pagamento.forma];
  const descricaoPagamento = textoBanco(`${forma} na ${pedido.entrega.tipo === 'entrega' ? 'entrega' : 'retirada'}${trocoPara ? ` (troco para ${brl(trocoPara)})` : ''}`, 60);

  const entrega = pedido.entrega.tipo === 'entrega' ? pedido.entrega.endereco : undefined;
  if (pedido.entrega.tipo === 'entrega' && !entrega) throw new RecusadoPelaPlataforma('O pedido de entrega está sem o endereço.');
  const transporte = entrega ? 'Entrega' : 'Retirada na Loja';
  const observacoes = textoBanco([trocoPara ? `Troco para ${brl(trocoPara)}.` : '', pedido.observacoes ?? ''].filter(Boolean).join(' '), 500);

  const cabecalho: Record<string, unknown> = {
    filiCodigo: codigoFilial,
    peecCodigo_Ecommerce: referencia,
    peecCanal: config.canal,
    peecParceiro: config.parceiro,
    Codigo_Parceiro_Ecommerce: config.codigoParceiro,
    peecValor_Total: total,
    peecValor_Frete: frete,
    peecValor_Desconto: desconto,
    peecUltimo_Evento: EVENTO_NOVO,
    peecNome_Cliente: textoBanco(pedido.cliente.nome, 100),
    peecTelefone_Cliente: digitos(pedido.cliente.telefone, 13),
    peecEmail_Cliente: textoBanco(pedido.cliente.email, 120),
    peecDocumento_Cliente: digitos(pedido.cliente.documento, 14),
    peecCep_Entrega: digitos(entrega?.cep, 8),
    peecLogradouro_Entrega: textoBanco(entrega?.rua, 200),
    peecNumero_Entrega: textoBanco(entrega?.numero, 20),
    peecBairro_Entrega: textoBanco(entrega?.bairro, 100),
    peecCidade_Entrega: textoBanco(entrega?.cidade, 100),
    peecUF_Entrega: textoBanco(entrega?.estado, 2).toUpperCase(),
    peecComplemento_Entrega: textoBanco(entrega?.complemento, 150),
    peecReferencia_Entrega: textoBanco(entrega?.referencia, 250),
    peecIdentificacao_Pagamento: codigoCondicao,
    peecDescricao_Pagamento: descricaoPagamento,
    peecQuantidade_Parcelas_Pagamento: 1,
    peecValor_Parcela_Pagamento: total,
    peecPagamento_Realizado: 0,
    peecTroco_Pagamento: trocoPara ? centavos(trocoPara - total) : 0,
    peecTransporte_Servico: transporte,
    peecTransporte_Metodo: transporte,
    peecObservacoes_Entrega: observacoes,
    Situacao: 'ATIVO',
    // 'N' = ainda não transmitido para a loja (o ERP marca 'S' quando recebe).
    Status_Transmissao: 'N',
  };
  const colunas = Object.keys(cabecalho);
  const { idInserido: codigo } = await tx.executar(
    `INSERT INTO ${TABELA_PEDIDO} (${colunas.join(', ')}, peecData_Cadastro, peecData_Atualizacao, peecData_Entrega)
     VALUES (${colunas.map(() => '?').join(', ')}, NOW(), NOW(), CURDATE())`,
    Object.values(cabecalho),
  );
  if (!codigo) throw new RecusadoPelaPlataforma('O banco de dados da loja não devolveu o número do pedido.');

  await tx.executar(
    `INSERT INTO ${TABELA_ITENS} (Codigo_Pedido_Ecommerce, filiCodigo_Pedido_Ecommerce, Codigo_Mercadoria, itpeDescricao_Mercadoria, itpeQuantidade, itpeValor)
     VALUES ${itens.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
    itens.flatMap((i) => [codigo, codigoFilial, i.codigo, i.nome, i.quantidade, i.preco]),
  );
  await tx.executar(
    `INSERT INTO ${TABELA_PAGAMENTO} (Codigo_Pedido_Ecommerce, filiCodigo_Pedido_Ecommerce, ipepPagamento_Realizado, ipepCodigo_Condicao_Pagamento,
       ipepForma_Pagamento, ipepDescricao_Pagamento, ipepValor_Total, ipepQuantidade_Parcelas_Pagamento, ipepNSU_Pagamento, ipepBandeira_Pagamento)
     VALUES (?, ?, 0, ?, ?, ?, ?, 1, '', '')`,
    [codigo, codigoFilial, codigoCondicao, textoBanco(forma, 25), descricaoPagamento, total],
  );
  return criado(codigo, 'ATIVO');
}

/** O idExterno que criarPedido devolve: "<filial>-<código do pedido>". */
export function lerIdExterno(idExterno: string): { filial: number; codigo: number } {
  const m = /^(\d{1,9})-(\d{1,11})$/.exec(String(idExterno ?? '').trim());
  if (!m) throw new RecusadoPelaPlataforma('Pedido do ERP não reconhecido.');
  return { filial: Number(m[1]), codigo: Number(m[2]) };
}

const SITUACOES: Record<string, string> = {
  'EM SEPARACAO': 'Em separação',
  FATURADO: 'Faturado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

/** Linha do pedido (Situacao e Status_Transmissao) no formato do contrato. Só ATIVO ainda pode ser cancelado. */
export function situacaoDaLinha(l: Linha): SituacaoPedido {
  const status = chave(texto(l.Situacao));
  if (status === 'ATIVO') {
    const recebido = texto(l.Status_Transmissao).toUpperCase() === 'S';
    return { status, descricao: recebido ? 'Recebido pela loja' : 'Enviado, aguardando a loja receber', cancelavel: true };
  }
  return { status, descricao: SITUACOES[status] ?? titulo(status), cancelavel: false };
}

/** Lê o pedido do Kentro Shop na filial logada (pedido de outra filial ou de outro parceiro não aparece). */
const SQL_SITUACAO = `SELECT p.Situacao, p.Status_Transmissao FROM ${TABELA_PEDIDO} p
  JOIN ${VIEW_FILIAL_LOGADA} f ON f.codigo_filial = p.filiCodigo
  WHERE p.Codigo = ? AND p.filiCodigo = ? AND p.peecParceiro = ? LIMIT 1`;

function configObrigatoria(ctx: CtxConector): ConfigPedido {
  const config = lerConfigPedido(ctx.credenciais);
  if (!config || typeof config === 'string') throw new RecusadoPelaPlataforma('Os pedidos para o ERP não estão configurados nesta loja.');
  return config;
}

const pedidoSumiu = () => new RecusadoPelaPlataforma('O pedido não foi encontrado no ERP desta filial.');

async function cancelarNoErp(tx: TransacaoBanco, config: ConfigPedido, filial: number, codigo: number): Promise<SituacaoPedido> {
  // A filial à parte: o FOR UPDATE com a view travaria também as tabelas internas do ERP.
  const [logada] = await tx.consultar(`SELECT codigo_filial FROM ${VIEW_FILIAL_LOGADA} LIMIT 1`);
  if (Number(logada?.codigo_filial) !== filial) throw pedidoSumiu();
  const [linha] = await tx.consultar(
    `SELECT Situacao, Status_Transmissao FROM ${TABELA_PEDIDO} WHERE Codigo = ? AND filiCodigo = ? AND peecParceiro = ? LIMIT 1 FOR UPDATE`,
    [codigo, filial, config.parceiro],
  );
  if (!linha) throw pedidoSumiu();
  const atual = situacaoDaLinha(linha);
  if (atual.status === 'CANCELADO') return atual;
  if (!atual.cancelavel) throw new RecusadoPelaPlataforma(`O pedido já está ${atual.descricao.toLowerCase()} na loja: o cancelamento precisa ser feito pela loja.`);
  const { linhasAfetadas } = await tx.executar(
    `UPDATE ${TABELA_PEDIDO} SET Situacao = 'CANCELADO', peecUltimo_Evento = 'pedido_cancelado', peecData_Atualizacao = NOW()
      WHERE Codigo = ? AND filiCodigo = ? AND peecParceiro = ? AND Situacao = 'ATIVO'`,
    [codigo, filial, config.parceiro],
  );
  // Só a linha do pedido: se mudou de situação no meio, desfaz e pede para conferir de novo.
  if (linhasAfetadas !== 1) throw new RecusadoPelaPlataforma('O pedido mudou na loja durante o cancelamento. Atualize a situação e confira.');
  return { status: 'CANCELADO', descricao: SITUACOES.CANCELADO, cancelavel: false };
}

function banco(ctx: CtxConector): ClienteBanco {
  if (!ctx.banco) throw new RecusadoPelaPlataforma('O banco de dados da loja não está disponível agora.');
  return ctx.banco;
}

function copia(ctx: CtxConector): CatalogoLocal {
  if (!ctx.catalogoLocal) throw new RecusadoPelaPlataforma('O catálogo sincronizado não está disponível agora.');
  return ctx.catalogoLocal;
}

export const conectorAutomatiza: Conector = {
  id: 'automatiza',
  nome: 'ERP Automatiza (banco de dados)',
  ritmo: { porSegundo: 20, rajada: 40 },
  banco: { motor: 'mysql', bancoPadrao: BANCO_PADRAO },
  sincronizacao: { minutos: 15 },
  // O banco do ERP não tem imagens: a farmácia publica as fotos num FTP, nomeadas pelo código de barras.
  fotosFtp: { minutos: 60 },
  // Farmácia de delivery: o pedido entra no ERP e o cliente paga ao receber (dinheiro, cartão ou PIX).
  pagamentoNaEntrega: true,
  capacidades: {
    buscaTextual: true,
    categorias: true,
    variacoes: false,
    estoque: true,
    relacionados: false,
    cotarFrete: false,
    criarPedido: true,
    oauth: false,
    historicoCliente: false,
  },
  camposDeCredencial: [...camposMysql(BANCO_PADRAO), ...camposFtpFotos(), ...camposPedido()],

  // A senha do banco e a do FTP vão para servidores diferentes: trocar um não pede a senha do outro.
  destino: (c) => ({ senha: destinoBanco(c), ftp_senha: destinoFtp(c) }),

  validarCredenciais(c) {
    const banco = lerCredenciaisBanco(c, BANCO_PADRAO);
    if (typeof banco === 'string') return banco;
    const ftp = lerCredenciaisFtp(c);
    if (typeof ftp === 'string') return ftp;
    const pedido = lerConfigPedido(c);
    return typeof pedido === 'string' ? pedido : null;
  },

  // Só com o código de parceiro combinado com o fornecedor do ERP o pedido vai para o banco.
  criaPedido: (c) => {
    const config = lerConfigPedido(c);
    return !!config && typeof config !== 'string';
  },

  async criarPedido(ctx, pedido) {
    const config = configObrigatoria(ctx);
    conferirPedido(pedido); // antes de abrir a conexão
    const cliente = banco(ctx);
    if (!cliente.gravar) throw new RecusadoPelaPlataforma('O banco de dados da loja não aceita pedidos agora.');
    return cliente.gravar('criar_pedido', TABELAS_DO_PEDIDO, (tx) => gravarPedido(tx, config, pedido));
  },

  async situacaoPedido(ctx, idExterno) {
    const config = configObrigatoria(ctx);
    const { filial, codigo } = lerIdExterno(idExterno);
    const [linha] = await banco(ctx).consultar('situacao_pedido', SQL_SITUACAO, [codigo, filial, config.parceiro]);
    if (!linha) throw pedidoSumiu();
    return situacaoDaLinha(linha);
  },

  // UPDATE só no cabeçalho do pedido, só do Kentro Shop, só na filial logada e só enquanto a loja não começou a separar.
  async cancelarPedido(ctx, idExterno) {
    const config = configObrigatoria(ctx);
    const { filial, codigo } = lerIdExterno(idExterno);
    const cliente = banco(ctx);
    if (!cliente.gravar) throw new RecusadoPelaPlataforma('O banco de dados da loja não aceita alterações agora.');
    return cliente.gravar('cancelar_pedido', [TABELA_PEDIDO], (tx) => cancelarNoErp(tx, config, filial, codigo));
  },

  async testarConexao(ctx) {
    const [filial] = await banco(ctx).consultar('testar_conexao', `SELECT codigo_filial, filial_fantasia FROM ${VIEW_FILIAL_LOGADA} LIMIT 1`);
    if (!filial) {
      return { ok: false, mensagem: 'O banco respondeu, mas o usuário não está ligado a nenhuma filial. Peça ao responsável pelo ERP para configurar a filial desse usuário.' };
    }
    const nomeFilial = texto(filial.filial_fantasia) || `Filial ${texto(filial.codigo_filial)}`;
    const { sincronizadoEm, total } = await copia(ctx).estado();
    if (!sincronizadoEm) return { ok: false, mensagem: `Banco conectado (${nomeFilial}), mas os produtos ainda não foram sincronizados. Clique em "Sincronizar agora".` };
    if (!total) return { ok: false, mensagem: `Banco conectado (${nomeFilial}), mas nenhum produto ativo com estoque e preço de delivery foi encontrado.` };
    return { ok: true, nomeLoja: `${nomeFilial} (${total} ${total === 1 ? 'produto' : 'produtos'})` };
  },

  async lerCatalogoCompleto(ctx) {
    // Filtrar no SQL não deixa a view mais rápida, mas reduz o que trafega (a maior parte não tem estoque).
    const linhas = await banco(ctx).consultar(
      'sincronizar_catalogo',
      `SELECT codigo_mercadoria, EAN, descricao, preco_venda, preco_venda_delivery, estoque, laboratorio,
              grupo_principal, subgrupo, cotrole_especial, tipo_controle, situacao
         FROM ${VIEW_PRODUTOS}
        WHERE situacao = ? AND estoque > 0
        LIMIT ${MAX_PRODUTOS + 1}`,
      ['ATIVO'],
      { timeoutMs: 120_000 },
    );
    if (linhas.length > MAX_PRODUTOS) {
      throw new RecusadoPelaPlataforma(`O catálogo passa de ${MAX_PRODUTOS} produtos com estoque, acima do que o Kentro Shop sincroniza.`);
    }
    const produtos = linhas.map(produtoDaView).filter((p): p is ProdutoSincronizado => !!p);
    const usadas = new Set(produtos.flatMap((p) => p.produto.categoriaIds));
    return { produtos, categorias: categoriasDaView(linhas, usadas) };
  },

  listarCategorias: async (ctx) => copia(ctx).categorias(),
  listarProdutos: async (ctx, filtro) => copia(ctx).produtos(filtro),
  obterProduto: async (ctx, id) => copia(ctx).produto(id.trim()),
};
