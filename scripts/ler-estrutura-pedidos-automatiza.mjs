// Levanta como o ERP Automatiza recebe pedidos, para implementar o criarPedido do conector.
// Sessão SOMENTE LEITURA: o script não grava nada no banco.
// Uso, no PowerShell (as credenciais ficam só nas variáveis desta execução):
//   $env:AUTOMATIZA_HOST='191.242.194.78'; $env:AUTOMATIZA_PORTA='9534'; $env:AUTOMATIZA_USUARIO='delivery'
//   $env:AUTOMATIZA_SENHA='...'; node scripts/ler-estrutura-pedidos-automatiza.mjs
// Opcional: AUTOMATIZA_BANCO (padrão automatiza), AUTOMATIZA_TABELAS=tab1,tab2 (padrão: as que o usuário pode gravar).
// Saída: estrutura-pedidos-automatiza.json na pasta atual. Dos pedidos já gravados, só saem os valores de colunas
// com poucos valores diferentes (status, canal, parceiro...); nome, telefone, documento e endereço viram só contagem.
import { writeFileSync } from 'node:fs';
import { createConnection } from 'mysql2/promise';

const host = (process.env.AUTOMATIZA_HOST ?? '').trim();
const usuario = (process.env.AUTOMATIZA_USUARIO ?? '').trim();
const senha = process.env.AUTOMATIZA_SENHA ?? '';
const banco = (process.env.AUTOMATIZA_BANCO ?? '').trim() || 'automatiza';
if (!host || !usuario || !senha) {
  console.error('Informe AUTOMATIZA_HOST, AUTOMATIZA_USUARIO e AUTOMATIZA_SENHA (e AUTOMATIZA_PORTA, se não for 3306).');
  process.exit(1);
}

const AMOSTRA = 1000;
const MAX_VALORES = 20;
const PESSOAL = /(nome|fone|tel|cel|whats|cpf|cnpj|doc|rg|mail|ende|logr|rua|bairro|cep|compl|num|refer|obs|nasc|lat|lon|token|senha|cartao|card)/i;

const conexao = await createConnection({
  host,
  port: Number(process.env.AUTOMATIZA_PORTA || 3306),
  user: usuario,
  password: senha,
  database: banco,
  connectTimeout: 10_000,
  charset: 'UTF8MB4_GENERAL_CI',
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
await conexao.query('SET SESSION TRANSACTION READ ONLY');

async function ler(sql, valores = []) {
  try {
    const [linhas] = await conexao.query({ sql, values: valores, timeout: 60_000 });
    return linhas;
  } catch (e) {
    return { erro: `${e.code ?? ''} ${e.message ?? e}`.trim() };
  }
}

const saida = { _lidoEm: new Date().toISOString(), banco };
saida.permissoes = await ler('SHOW GRANTS FOR CURRENT_USER()');
saida.usuarioAtual = await ler('SELECT CURRENT_USER() AS usuario, VERSION() AS versao');
saida.filialLogada = await ler('SELECT * FROM view_ecommerce_delivery_filial_logada LIMIT 1');

// Tabelas: as informadas, ou as que o usuário pode gravar (permissão por tabela), ou as de nome parecido.
let tabelas = (process.env.AUTOMATIZA_TABELAS ?? '').split(',').map((t) => t.trim()).filter(Boolean);
if (!tabelas.length) {
  const privilegios = await ler(
    `SELECT DISTINCT TABLE_NAME AS t FROM information_schema.TABLE_PRIVILEGES
      WHERE TABLE_SCHEMA = ? AND PRIVILEGE_TYPE IN ('INSERT', 'UPDATE')`,
    [banco],
  );
  if (Array.isArray(privilegios)) tabelas = privilegios.map((l) => l.t);
}
if (!tabelas.length) {
  const parecidas = await ler(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND (TABLE_NAME LIKE '%ecommerce%' OR TABLE_NAME LIKE '%pedido%')`,
    [banco],
  );
  if (Array.isArray(parecidas)) tabelas = parecidas.map((l) => l.t);
}
saida.tabelas = {};

function resumirColuna(nome, valores) {
  const preenchidos = valores.filter((v) => v !== null && v !== '');
  const contagem = new Map();
  for (const v of preenchidos) contagem.set(String(v), (contagem.get(String(v)) ?? 0) + 1);
  const resumo = { vazios: valores.length - preenchidos.length, diferentes: contagem.size };
  if (preenchidos.length) {
    const textos = preenchidos.map(String);
    resumo.maiorTamanho = Math.max(...textos.map((t) => t.length));
    if (!PESSOAL.test(nome)) {
      if (contagem.size <= MAX_VALORES) {
        resumo.valores = Object.fromEntries([...contagem.entries()].sort((a, b) => b[1] - a[1]));
      } else if (textos.every((t) => /^-?\d+(\.\d+)?$/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t))) {
        const ordenados = [...textos].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
        resumo.menor = ordenados[0];
        resumo.maior = ordenados[ordenados.length - 1];
      }
    }
  }
  return resumo;
}

for (const tabela of tabelas) {
  if (!/^[A-Za-z0-9_$]{1,64}$/.test(tabela)) continue;
  const info = {};
  info.criacao = await ler(`SHOW CREATE TABLE \`${tabela}\``);
  info.colunas = await ler(
    `SELECT COLUMN_NAME AS nome, COLUMN_TYPE AS tipo, IS_NULLABLE AS aceitaNulo, COLUMN_DEFAULT AS padrao,
            COLUMN_KEY AS chave, EXTRA AS extra, COLUMN_COMMENT AS comentario
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [banco, tabela],
  );
  info.chavesEstrangeiras = await ler(
    `SELECT COLUMN_NAME AS coluna, REFERENCED_TABLE_NAME AS tabela, REFERENCED_COLUMN_NAME AS colunaReferida
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [banco, tabela],
  );
  info.gatilhos = await ler(
    `SELECT TRIGGER_NAME AS nome, ACTION_TIMING AS quando, EVENT_MANIPULATION AS evento, ACTION_STATEMENT AS corpo
       FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?`,
    [banco, tabela],
  );
  const total = await ler(`SELECT COUNT(*) AS total FROM \`${tabela}\``);
  info.totalLinhas = Array.isArray(total) ? total[0]?.total : total;

  // Amostra dos registros mais recentes, resumida por coluna (os valores pessoais não saem).
  const primaria = Array.isArray(info.colunas) ? info.colunas.find((c) => c.chave === 'PRI')?.nome : undefined;
  const ordem = primaria ? `ORDER BY \`${primaria}\` DESC` : '';
  const amostra = await ler(`SELECT * FROM \`${tabela}\` ${ordem} LIMIT ${AMOSTRA}`);
  if (Array.isArray(amostra)) {
    info.amostra = { linhas: amostra.length, colunas: {} };
    const nomes = amostra.length ? Object.keys(amostra[0]) : [];
    for (const nome of nomes) info.amostra.colunas[nome] = resumirColuna(nome, amostra.map((l) => l[nome]));
  } else {
    info.amostra = amostra;
  }
  saida.tabelas[tabela] = info;
}

// Procedimentos do ERP para o e-commerce (às vezes o pedido entra por um deles, não por INSERT direto).
saida.rotinas = await ler(
  `SELECT ROUTINE_NAME AS nome, ROUTINE_TYPE AS tipo FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = ? AND (ROUTINE_NAME LIKE '%ecommerce%' OR ROUTINE_NAME LIKE '%pedido%' OR ROUTINE_NAME LIKE '%delivery%')`,
  [banco],
);
saida.views = await ler(
  `SELECT TABLE_NAME AS nome FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE '%ecommerce%'`,
  [banco],
);

await conexao.end();
const arquivo = 'estrutura-pedidos-automatiza.json';
writeFileSync(arquivo, JSON.stringify(saida, null, 2));
console.log(`Tabelas lidas: ${Object.keys(saida.tabelas).join(', ') || 'nenhuma'}`);
console.log(`Gravado em ${arquivo}. Nada foi alterado no banco.`);
