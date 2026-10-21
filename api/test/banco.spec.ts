import { ChamadaRegistrada } from '../src/conectores/nucleo/cliente-http';
import { ConexaoMysql, criarClienteMysql, lerCredenciaisBanco, OpcoesClienteBanco, traduzirErroMysql } from '../src/conectores/nucleo/banco';
import { CredencialInvalida, PlataformaIndisponivel, RecusadoPelaPlataforma } from '../src/conectores/nucleo/erros';

const CREDENCIAIS = { host: 'banco.erp.teste', porta: '9534', usuario: 'delivery', senha: 's3nha', banco: '' };

function montar(conexao: Partial<ConexaoMysql> = {}, extra: { ips?: string[]; credenciais?: Record<string, string> } = {}) {
  const chamadas: ChamadaRegistrada[] = [];
  const sqls: string[] = [];
  const configs: Record<string, unknown>[] = [];
  let encerrada = 0;
  const opcoes: OpcoesClienteBanco = {
    lojaId: 'l1',
    plataforma: 'automatiza',
    motor: 'mysql',
    bancoPadrao: 'automatiza',
    credenciais: extra.credenciais ?? CREDENCIAIS,
    registrar: async (c) => {
      chamadas.push(c);
    },
  };
  const cliente = criarClienteMysql(opcoes, {
    resolver: async () => extra.ips ?? ['200.10.20.30'],
    conectar: async (config) => {
      configs.push(config as Record<string, unknown>);
      return {
        query: async ({ sql }) => {
          sqls.push(sql);
          return [sql.startsWith('SET') ? {} : [{ ok: 1 }], []];
        },
        end: async () => {
          encerrada += 1;
        },
        destroy: () => undefined,
        ...conexao,
      };
    },
  });
  return { cliente, chamadas, sqls, configs, encerradas: () => encerrada };
}

describe('cliente de banco MySQL', () => {
  it('conecta no IP conferido, abre a sessão só leitura, consulta, registra e fecha', async () => {
    const m = montar();
    expect(await m.cliente.consultar('testar_conexao', 'SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
    expect(m.configs[0]).toMatchObject({ host: '200.10.20.30', port: 9534, user: 'delivery', password: 's3nha', database: 'automatiza', multipleStatements: false });
    expect(m.sqls).toEqual(['SET SESSION TRANSACTION READ ONLY', 'SELECT 1 AS ok']);
    expect(m.chamadas).toEqual([{ lojaId: 'l1', plataforma: 'automatiza', operacao: 'testar_conexao', statusHttp: null, ms: expect.any(Number), erroCodigo: null }]);
    expect(m.encerradas()).toBe(1);
  });

  it('recusa nome que resolve para a rede interna, sem conectar', async () => {
    const m = montar({}, { ips: ['10.0.0.5'] });
    await expect(m.cliente.consultar('x', 'SELECT 1')).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
    expect(m.configs).toEqual([]);
    expect(m.chamadas[0].erroCodigo).toBe('RECUSADO_PELA_PLATAFORMA');
  });

  it('recusa IP privado literal e credencial incompleta, sem conectar', async () => {
    for (const credenciais of [{ ...CREDENCIAIS, host: '127.0.0.1' }, { ...CREDENCIAIS, host: '169.254.169.254' }, { ...CREDENCIAIS, senha: '' }]) {
      const m = montar({}, { credenciais });
      await expect(m.cliente.consultar('x', 'SELECT 1')).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
      expect(m.configs).toEqual([]);
    }
  });

  it('traduz o erro do MySQL e fecha a conexão mesmo assim', async () => {
    const negado = Object.assign(new Error("Access denied for user 'delivery'"), { code: 'ER_ACCESS_DENIED_ERROR' });
    const m = montar({
      query: async ({ sql }) => {
        if (sql.startsWith('SET')) return [{}, []];
        throw negado;
      },
    });
    await expect(m.cliente.consultar('x', 'SELECT 1')).rejects.toBeInstanceOf(CredencialInvalida);
    expect(m.chamadas[0].erroCodigo).toBe('CREDENCIAL_INVALIDA');
    expect(m.encerradas()).toBe(1);
  });

  it('cada erro do MySQL vira um erro padrão, sem a mensagem do banco', () => {
    const erro = (code: string) => traduzirErroMysql(Object.assign(new Error('detalhe interno do servidor'), { code }));
    expect(erro('ER_DBACCESS_DENIED_ERROR')).toBeInstanceOf(CredencialInvalida);
    expect(erro('ER_TABLEACCESS_DENIED_ERROR').message).toMatch(/não tem acesso a uma das views/);
    expect(erro('ER_BAD_DB_ERROR').message).toMatch(/banco informado não existe/);
    expect(erro('ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION').message).toBe('O Kentro Shop só lê o banco de dados da loja.');
    expect(erro('ER_HOST_NOT_PRIVILEGED').message).toMatch(/não aceita conexões/);
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_ALGO_NOVO']) {
      expect(erro(code)).toBeInstanceOf(PlataformaIndisponivel);
      expect(erro(code).message).not.toMatch(/detalhe interno/);
    }
  });

  it('lê as credenciais: porta padrão, banco padrão e host normalizado', () => {
    expect(lerCredenciaisBanco({ ...CREDENCIAIS, host: ' Banco.ERP.teste ', porta: '' }, 'automatiza')).toEqual({
      host: 'banco.erp.teste',
      porta: 3306,
      usuario: 'delivery',
      senha: 's3nha',
      banco: 'automatiza',
    });
    expect(lerCredenciaisBanco({ ...CREDENCIAIS, host: 'banco.erp.teste:3306' })).toMatch(/sem http:\/\/, porta ou barra/);
    expect(lerCredenciaisBanco({ ...CREDENCIAIS, host: 'fd00::1' })).toMatch(/endereço público/);
    expect(lerCredenciaisBanco({ ...CREDENCIAIS, porta: '0' })).toMatch(/porta/);
  });
});
