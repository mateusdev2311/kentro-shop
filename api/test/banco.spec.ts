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

  it('gravar: transação sem a trava de só leitura, devolve o AUTO_INCREMENT e confirma no fim', async () => {
    const valores: unknown[][] = [];
    const sqls: string[] = [];
    const m = montar({
      query: async ({ sql, values }) => {
        sqls.push(sql);
        valores.push(values ?? []);
        return [sql.startsWith('INSERT') ? { insertId: 107900, affectedRows: 1 } : [], []];
      },
    });
    const r = await m.cliente.gravar!('criar_pedido', ['pedido_ecommerce'], async (tx) => {
      await tx.consultar('SELECT codigo_filial FROM view_ecommerce_delivery_filial_logada LIMIT 1');
      return tx.executar('INSERT INTO pedido_ecommerce (peecNome_Cliente) VALUES (?)', ['Ana']);
    });
    expect(r).toEqual({ idInserido: 107900, linhasAfetadas: 1 });
    expect(sqls).toEqual([
      'START TRANSACTION',
      'SELECT codigo_filial FROM view_ecommerce_delivery_filial_logada LIMIT 1',
      'INSERT INTO pedido_ecommerce (peecNome_Cliente) VALUES (?)',
      'COMMIT',
    ]);
    expect(valores[2]).toEqual(['Ana']);
    expect(m.chamadas).toEqual([expect.objectContaining({ operacao: 'criar_pedido', erroCodigo: null })]);
    expect(m.encerradas()).toBe(1);
  });

  it('gravar: erro no meio desfaz (ROLLBACK), traduz o erro e fecha a conexão', async () => {
    const sqls: string[] = [];
    const m = montar({
      query: async ({ sql }) => {
        sqls.push(sql);
        if (sql.includes('itens_pedido_ecommerce_pagamento')) throw Object.assign(new Error("Column 'x' cannot be null"), { code: 'ER_BAD_NULL_ERROR' });
        return [{ insertId: 1, affectedRows: 1 }, []];
      },
    });
    const gravar = m.cliente.gravar!('criar_pedido', ['pedido_ecommerce', 'itens_pedido_ecommerce_pagamento'], async (tx) => {
      await tx.executar('INSERT INTO pedido_ecommerce (a) VALUES (?)', [1]);
      await tx.executar('INSERT INTO itens_pedido_ecommerce_pagamento (a) VALUES (?)', [1]);
    });
    await expect(gravar).rejects.toThrow('O banco de dados da loja recusou os dados do pedido.');
    expect(sqls.at(-1)).toBe('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(m.chamadas[0].erroCodigo).toBe('RECUSADO_PELA_PLATAFORMA');
    expect(m.encerradas()).toBe(1);
  });

  it('gravar: comando fora das tabelas liberadas não chega ao banco', async () => {
    for (const sql of ['DELETE FROM pedido_ecommerce', 'UPDATE produtos SET preco = ?', 'INSERT INTO pedido_ecommerce_backup (a) VALUES (?)', 'DROP TABLE pedido_ecommerce']) {
      const m = montar();
      await expect(m.cliente.gravar!('x', ['pedido_ecommerce'], (tx) => tx.executar(sql, []))).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
      expect(m.sqls).toEqual(['START TRANSACTION', 'ROLLBACK']);
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
