import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ConnectionOptions, createConnection } from 'mysql2/promise';
import { ChamadaRegistrada } from './cliente-http';
import { CampoCredencial } from './conector';
import { hostPublico, ipPrivado, Resolvedor } from './destino';
import { CredencialInvalida, ErroConector, PlataformaIndisponivel, RecusadoPelaPlataforma } from './erros';

// Conectores que leem o banco de dados do ERP da loja (ex.: views liberadas para o e-commerce).
// A consulta abre a sessão somente leitura. Gravar (ex.: o pedido) é só por `gravar`: uma transação, com INSERT e
// UPDATE apenas nas tabelas que o conector declara. A API só conecta em endereço público (proteção contra SSRF).

export type MotorBanco = 'mysql';

export type Linha = Record<string, unknown>;

export interface OpcoesConsulta {
  /** Padrão: 15 s. A leitura do catálogo inteiro pede mais. */
  timeoutMs?: number;
}

export interface ResultadoGravacao {
  /** AUTO_INCREMENT gerado pelo INSERT (0 se não houver). */
  idInserido: number;
  linhasAfetadas: number;
}

/** Dentro da transação de `gravar`. Valores sempre por parâmetro (?), nunca concatenados no SQL. */
export interface TransacaoBanco {
  consultar(sql: string, parametros?: unknown[]): Promise<Linha[]>;
  /** Só INSERT INTO ou UPDATE de uma das tabelas liberadas em `gravar`. */
  executar(sql: string, parametros?: unknown[]): Promise<ResultadoGravacao>;
}

export interface ClienteBanco {
  /** Só leitura. Valores sempre por parâmetro (?), nunca concatenados no SQL. */
  consultar(operacao: string, sql: string, parametros?: unknown[], opcoes?: OpcoesConsulta): Promise<Linha[]>;
  /**
   * Uma transação: confirma se `passos` terminar, desfaz tudo se qualquer passo falhar. Grava só em `tabelas`.
   * Ausente = o cliente não grava.
   */
  gravar?<T>(operacao: string, tabelas: readonly string[], passos: (tx: TransacaoBanco) => Promise<T>, opcoes?: OpcoesConsulta): Promise<T>;
}

const COMANDO_GRAVACAO = /^\s*(?:INSERT\s+INTO|UPDATE)\s+`?([A-Za-z0-9_$]+)`?[\s(]/i;

/** A tabela que o comando grava, se ele for um INSERT INTO ou UPDATE simples; senão, null. */
export function tabelaGravada(sql: string): string | null {
  return COMANDO_GRAVACAO.exec(sql)?.[1] ?? null;
}

/** Recusa (sem executar) o que não for INSERT/UPDATE de uma tabela liberada. Erro de programação, não do banco. */
export function conferirGravacao(sql: string, tabelas: readonly string[]): void {
  const tabela = tabelaGravada(sql);
  if (!tabela || !tabelas.includes(tabela)) throw new RecusadoPelaPlataforma('O Kentro Shop só grava os pedidos no banco de dados da loja.');
}

export interface CredenciaisBanco {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
  banco: string;
}

export interface OpcoesClienteBanco {
  lojaId: string;
  plataforma: string;
  motor: MotorBanco;
  credenciais: Record<string, string>;
  /** Banco usado quando o campo vem vazio (ex.: o schema padrão do ERP). */
  bancoPadrao?: string;
  registrar: (chamada: ChamadaRegistrada) => Promise<void>;
}

/** Abre o cliente do banco da loja. Os testes trocam por um banco em memória. */
export type AbrirBanco = (opcoes: OpcoesClienteBanco) => ClienteBanco;

export const ABRIR_BANCO = Symbol('ABRIR_BANCO');

const PORTA_MYSQL = 3306;
const NOME_HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Campos de credencial de um banco MySQL/MariaDB. */
export function camposMysql(bancoPadrao: string): CampoCredencial[] {
  return [
    { chave: 'host', rotulo: 'Servidor do banco', tipo: 'texto', obrigatorio: true, ajuda: 'IP ou nome público do servidor, sem http://. Ex.: 200.100.50.10' },
    { chave: 'porta', rotulo: 'Porta', tipo: 'texto', obrigatorio: false, ajuda: `Vazio = ${PORTA_MYSQL}.` },
    { chave: 'usuario', rotulo: 'Usuário', tipo: 'texto', obrigatorio: true },
    { chave: 'senha', rotulo: 'Senha', tipo: 'segredo', obrigatorio: true },
    { chave: 'banco', rotulo: 'Banco', tipo: 'texto', obrigatorio: false, ajuda: `Nome do banco (schema). Vazio = ${bancoPadrao}.` },
  ];
}

/** Credenciais conferidas, ou a mensagem do que está errado. */
export function lerCredenciaisBanco(c: Record<string, string>, bancoPadrao = ''): CredenciaisBanco | string {
  const host = (c.host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || (/[/:@\s]/.test(host) && !isIP(host))) return 'Informe só o IP ou o nome do servidor do banco, sem http://, porta ou barra.';
  if (!isIP(host) && !NOME_HOST.test(host)) return 'O servidor do banco não é um IP nem um nome válido.';
  if (!hostPublico(host)) return 'O servidor do banco precisa ter endereço público (a rede interna não é acessível pelo Kentro Shop).';
  const textoPorta = (c.porta ?? '').trim();
  const porta = textoPorta ? Number(textoPorta) : PORTA_MYSQL;
  if (!/^\d{0,5}$/.test(textoPorta) || !Number.isInteger(porta) || porta < 1 || porta > 65535) return 'A porta do banco precisa ser um número de 1 a 65535.';
  const banco = (c.banco ?? '').trim() || bancoPadrao;
  if (!/^[A-Za-z0-9_$]{1,64}$/.test(banco)) return 'O nome do banco só pode ter letras, números, _ e $.';
  const usuario = (c.usuario ?? '').trim();
  if (!usuario || !c.senha) return 'Informe o usuário e a senha do banco.';
  return { host, porta, usuario, senha: c.senha, banco };
}

/** Para onde a senha vai: trocar o servidor ou a porta exige digitar a senha de novo. */
export function destinoBanco(c: Record<string, string>): string {
  return `${(c.host ?? '').trim().toLowerCase()}:${(c.porta ?? '').trim() || PORTA_MYSQL}`;
}

/** Sem DNS para IP privado: a conexão vai para o IP conferido (um segundo lookup poderia trocar o destino). */
export async function resolverHostPublico(host: string, resolver: Resolvedor): Promise<string> {
  if (isIP(host)) {
    if (ipPrivado(host)) throw new RecusadoPelaPlataforma('O servidor do banco precisa ter endereço público.');
    return host;
  }
  let ips: string[];
  try {
    ips = await resolver(host);
  } catch {
    throw new PlataformaIndisponivel();
  }
  if (!ips.length || ips.some(ipPrivado)) throw new RecusadoPelaPlataforma('O servidor do banco precisa ter endereço público.');
  return ips[0];
}

const SEM_ACESSO = 'O usuário do banco não tem acesso a uma das views necessárias (ou ela não existe). Peça ao responsável pelo ERP para liberar.';

/** Erro do driver MySQL no erro padrão dos conectores (a mensagem do banco nunca volta para a tela). */
export function traduzirErroMysql(e: unknown): ErroConector {
  if (e instanceof ErroConector) return e;
  const codigo = String((e as { code?: unknown } | null)?.code ?? '');
  switch (codigo) {
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return new CredencialInvalida();
    case 'ER_BAD_DB_ERROR':
      return new RecusadoPelaPlataforma('O banco informado não existe nesse servidor. Confira o campo Banco.');
    case 'ER_TABLEACCESS_DENIED_ERROR':
    case 'ER_COLUMNACCESS_DENIED_ERROR':
    case 'ER_PROCACCESS_DENIED_ERROR':
    case 'ER_SPECIFIC_ACCESS_DENIED_ERROR':
    case 'ER_NO_SUCH_TABLE':
    case 'ER_BAD_FIELD_ERROR':
      return new RecusadoPelaPlataforma(SEM_ACESSO);
    case 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION':
      return new RecusadoPelaPlataforma('O Kentro Shop só lê o banco de dados da loja.');
    case 'ER_BAD_NULL_ERROR':
    case 'ER_NO_DEFAULT_FOR_FIELD':
    case 'ER_DATA_TOO_LONG':
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD':
    case 'ER_WARN_DATA_OUT_OF_RANGE':
    case 'ER_DUP_ENTRY':
      return new RecusadoPelaPlataforma('O banco de dados da loja recusou os dados do pedido.');
    case 'ER_LOCK_WAIT_TIMEOUT':
    case 'ER_LOCK_DEADLOCK':
      return new PlataformaIndisponivel();
    case 'ER_HOST_NOT_PRIVILEGED':
    case 'ER_HOST_IS_BLOCKED':
      return new RecusadoPelaPlataforma('O servidor do banco não aceita conexões do Kentro Shop. Peça para liberar o acesso externo desse usuário.');
    default:
      // Rede, tempo esgotado, conexão perdida ou erro desconhecido do servidor.
      return new PlataformaIndisponivel();
  }
}

/** O mínimo do mysql2 que o cliente usa (os testes trocam por um falso). */
export interface ConexaoMysql {
  query(opcoes: { sql: string; values?: unknown[]; timeout?: number }): Promise<[unknown, unknown]>;
  end(): Promise<void>;
  destroy(): void;
}

export interface DependenciasMysql {
  conectar?: (config: ConnectionOptions) => Promise<ConexaoMysql>;
  resolver?: Resolvedor;
}

const resolverDns: Resolvedor = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/** Uma conexão por operação: as idas ao banco são poucas (teste, sincronização e pedido), sem pool aberto por loja. */
export function criarClienteMysql(opcoes: OpcoesClienteBanco, deps: DependenciasMysql = {}): ClienteBanco {
  const conectar = deps.conectar ?? (async (config) => (await createConnection(config)) as unknown as ConexaoMysql);
  const resolver = deps.resolver ?? resolverDns;

  /** Abre a conexão, roda `usar`, registra a chamada (aba Saúde) e fecha; erro do driver vira erro padrão. */
  async function comConexao<T>(operacao: string, usar: (conexao: ConexaoMysql) => Promise<T>): Promise<T> {
    const inicio = Date.now();
    const registrar = (erroCodigo: string | null) =>
      opcoes
        .registrar({ lojaId: opcoes.lojaId, plataforma: opcoes.plataforma, operacao, statusHttp: null, ms: Date.now() - inicio, erroCodigo })
        .catch(() => undefined); // o registro nunca derruba a consulta

    let conexao: ConexaoMysql | null = null;
    try {
      const credenciais = lerCredenciaisBanco(opcoes.credenciais, opcoes.bancoPadrao);
      if (typeof credenciais === 'string') throw new RecusadoPelaPlataforma(credenciais);
      conexao = await conectar({
        host: await resolverHostPublico(credenciais.host, resolver),
        port: credenciais.porta,
        user: credenciais.usuario,
        password: credenciais.senha,
        database: credenciais.banco,
        connectTimeout: 10_000,
        charset: 'UTF8MB4_GENERAL_CI',
        // Data e decimal como texto: o conector decide como ler (sem fuso nem arredondamento do driver).
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
      });
      const resultado = await usar(conexao);
      await registrar(null);
      return resultado;
    } catch (e) {
      const erro = traduzirErroMysql(e);
      await registrar(erro.codigo);
      throw erro;
    } finally {
      if (conexao) await conexao.end().catch(() => conexao?.destroy());
    }
  }

  const linhasDe = (resposta: unknown): Linha[] => (Array.isArray(resposta) ? (resposta as Linha[]) : []);

  return {
    consultar(operacao, sql, parametros = [], { timeoutMs = 15_000 } = {}) {
      return comConexao(operacao, async (conexao) => {
        // O usuário pode ter permissão de escrita no ERP; a consulta só lê.
        await conexao.query({ sql: 'SET SESSION TRANSACTION READ ONLY', timeout: timeoutMs });
        const [linhas] = await conexao.query({ sql, values: parametros, timeout: timeoutMs });
        return linhasDe(linhas);
      });
    },

    gravar(operacao, tabelas, passos, { timeoutMs = 15_000 } = {}) {
      return comConexao(operacao, async (conexao) => {
        await conexao.query({ sql: 'START TRANSACTION', timeout: timeoutMs });
        const tx: TransacaoBanco = {
          async consultar(sql, parametros = []) {
            const [linhas] = await conexao.query({ sql, values: parametros, timeout: timeoutMs });
            return linhasDe(linhas);
          },
          async executar(sql, parametros = []) {
            conferirGravacao(sql, tabelas);
            const [r] = await conexao.query({ sql, values: parametros, timeout: timeoutMs });
            const info = (r ?? {}) as { insertId?: unknown; affectedRows?: unknown };
            return { idInserido: Number(info.insertId ?? 0) || 0, linhasAfetadas: Number(info.affectedRows ?? 0) || 0 };
          },
        };
        try {
          const resultado = await passos(tx);
          await conexao.query({ sql: 'COMMIT', timeout: timeoutMs });
          return resultado;
        } catch (e) {
          // Se nem o ROLLBACK passar, fechar a conexão sem COMMIT também desfaz a transação.
          await conexao.query({ sql: 'ROLLBACK', timeout: timeoutMs }).catch(() => undefined);
          throw e;
        }
      });
    },
  };
}

export const abrirBancoPadrao: AbrirBanco = (opcoes) => {
  if (opcoes.motor !== 'mysql') throw new RecusadoPelaPlataforma('Tipo de banco de dados não suportado.');
  return criarClienteMysql(opcoes);
};
