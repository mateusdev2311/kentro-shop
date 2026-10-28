import {
  TABELA_ITENS,
  TABELA_PAGAMENTO,
  TABELA_PEDIDO,
  VIEW_CONDICOES_PAGAMENTO,
  VIEW_FILIAL_LOGADA,
  VIEW_PRODUTOS,
} from '../../src/conectores/automatiza/automatiza.conector';
import { ClienteBanco, conferirGravacao, Linha, tabelaGravada, traduzirErroMysql } from '../../src/conectores/nucleo/banco';
import { CredencialInvalida, PlataformaIndisponivel } from '../../src/conectores/nucleo/erros';

// Banco do ERP Automatiza em memória: responde às consultas do conector como as views responderiam e guarda os
// pedidos gravados nas três tabelas (com transação: um erro no meio não deixa nada gravado). Dados sintéticos.

const linha = (codigo: number, descricao: string, extra: Partial<Record<string, string | number>> = {}): Linha => ({
  codigo_filial: 7,
  cnpj_filial: '00000000000100',
  EAN: `789000000${String(codigo).padStart(4, '0')}`,
  codigo_mercadoria: codigo,
  descricao,
  preco_venda: '10.00',
  preco_venda_loja: '10.00',
  preco_venda_delivery: '10.00',
  estoque: '5.00',
  laboratorio: 'LABORATORIO TESTE LTDA',
  grupo_principal: 'NAO MEDICAMENTOS',
  subgrupo: 'HIGIENE E BELEZA',
  categoria: 'NAO DEFINIDO',
  cotrole_especial: 'false',
  tipo_controle: '',
  situacao: 'ATIVO',
  ...extra,
});

export const LINHAS_VIEW: Linha[] = [
  linha(101, 'SABONETE NEUTRO 90G', { preco_venda: '4.99', preco_venda_delivery: '3.99' }),
  linha(102, 'SHAMPOO ANTICASPA 200ML', { preco_venda_delivery: '22.50', preco_venda: '22.50' }),
  linha(103, 'DIPIRONA 500MG 10 COMPRIMIDOS', { grupo_principal: 'GENERICO', subgrupo: 'GENERICO_OTC', preco_venda_delivery: '6.90', preco_venda: '6.90', estoque: '12.00' }),
  linha(104, 'PROTETOR SOLAR FPS50 120ML', { grupo_principal: 'REFERENCIA', subgrupo: 'DERMOCOSMETICOS', preco_venda_delivery: '59.90', preco_venda: '69.90' }),
  linha(105, 'HIDRATANTE FACIAL 50G', { subgrupo: 'DERMOCOSMETICOS ', preco_venda_delivery: '45.00', preco_venda: '45.00' }),
  // Ficam de fora: controlado, fora de linha, sem estoque, sem preço de delivery e uso interno.
  linha(201, 'ANTIBIOTICO TESTE 500MG', { grupo_principal: 'REFERENCIA', subgrupo: 'ETICO_RX', cotrole_especial: 'true', tipo_controle: 'Antibiotico' }),
  linha(202, 'PRODUTO FORA DE LINHA', { situacao: 'FORA DE LINHA' }),
  linha(203, 'PRODUTO SEM ESTOQUE', { estoque: '0.00' }),
  linha(204, 'PRODUTO SEM PRECO', { preco_venda_delivery: '0.00' }),
  linha(205, 'SACOLA PLASTICA', { grupo_principal: 'USO E CONSUMO', subgrupo: 'CONSUMO' }),
  linha(206, 'TAXA DE ENTREGA', { grupo_principal: 'NAO MEDICAMENTOS', subgrupo: 'ENTREGAS', preco_venda_delivery: '0.01' }),
];

export const CREDENCIAIS_BANCO = { host: 'banco.erp.teste', porta: '3306', usuario: 'delivery', senha: 'certa', banco: '' };

/** Como a view do ERP da Rede Biomax (o código de cada condição muda de um cliente para outro). */
export const CONDICOES_PAGAMENTO: Linha[] = [
  { codigo_pagamento: 2, descricao: 'CARTAO' },
  { codigo_pagamento: 3, descricao: 'CHEQUE' },
  { codigo_pagamento: 1, descricao: 'DINHEIRO' },
  { codigo_pagamento: 245, descricao: 'PIX' },
];

/** As três tabelas de pedido, com os pedidos de TODAS as filiais (como no banco real). */
export interface TabelasPedido {
  [TABELA_PEDIDO]: Linha[];
  [TABELA_ITENS]: Linha[];
  [TABELA_PAGAMENTO]: Linha[];
}

export const tabelasVazias = (): TabelasPedido => ({ [TABELA_PEDIDO]: [], [TABELA_ITENS]: [], [TABELA_PAGAMENTO]: [] });

export interface OpcoesBancoMemoria {
  linhas?: Linha[];
  filial?: Linha | null;
  /** Simula o banco fora do ar. */
  fora?: boolean;
  /** Onde os pedidos ficam (compartilhe entre bancos para simular várias filiais no mesmo servidor). */
  tabelas?: TabelasPedido;
  condicoes?: Linha[];
  /** Falha o comando de gravação que tiver este trecho (ex.: a tabela de pagamento). */
  falharEm?: string;
}

export interface BancoMemoria extends ClienteBanco {
  consultas: { operacao: string; sql: string; parametros: unknown[] }[];
  /** Comandos de gravação, na ordem, e o fim de cada transação. */
  gravacoes: { operacao: string; sql: string; parametros: unknown[] }[];
  tabelas: TabelasPedido;
}

/** Separa a lista de dentro dos parênteses por vírgula (os comandos do conector não têm vírgula em literal). */
const lista = (trecho: string) => trecho.split(',').map((t) => t.trim());

/** Linhas de um INSERT INTO t (colunas) VALUES (...), (...): `?` pega o próximo parâmetro; literal vira valor. */
function linhasDoInsert(sql: string, parametros: unknown[]): Linha[] {
  // Funções sem argumento viram um nome só (os parênteses delas confundiriam a separação das tuplas).
  const simples = sql.replace(/\b([A-Z_]+)\(\)/g, '$1');
  const [, colunas, valores] = /\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i.exec(simples) ?? [];
  const nomes = lista(colunas);
  const tuplas = [...valores.matchAll(/\(([^)]*)\)/g)].map((m) => lista(m[1]));
  let p = 0;
  return tuplas.map((tupla) =>
    Object.fromEntries(
      tupla.map((token, i) => {
        if (token === '?') return [nomes[i], parametros[p++]];
        if (token === "''") return [nomes[i], ''];
        if (/^\d+$/.test(token)) return [nomes[i], Number(token)];
        return [nomes[i], `<${token}>`]; // NOW, CURDATE
      }),
    ),
  );
}

/** Cliente de banco falso para as credenciais dadas: senha diferente de "certa" é recusada como no MySQL. */
export function bancoEmMemoria(credenciais: Record<string, string>, opcoes: OpcoesBancoMemoria = {}): BancoMemoria {
  const linhas = opcoes.linhas ?? LINHAS_VIEW;
  const filial = opcoes.filial === undefined ? { codigo_filial: 7, filial_fantasia: 'FARMACIA TESTE - LOJA07' } : opcoes.filial;
  const tabelas = opcoes.tabelas ?? tabelasVazias();
  const consultas: BancoMemoria['consultas'] = [];
  const gravacoes: BancoMemoria['gravacoes'] = [];

  const conferirAcesso = () => {
    if (opcoes.fora) throw new PlataformaIndisponivel();
    if (credenciais.senha !== 'certa') throw new CredencialInvalida();
  };
  const ler = (sql: string, parametros: unknown[], fonte: TabelasPedido): Linha[] => {
    if (sql.includes(`FROM ${VIEW_FILIAL_LOGADA}`)) return filial ? [filial] : [];
    if (sql.includes(VIEW_CONDICOES_PAGAMENTO)) return opcoes.condicoes ?? CONDICOES_PAGAMENTO;
    if (sql.includes(VIEW_PRODUTOS)) {
      // Como o WHERE do conector: situação pedida e estoque positivo.
      return linhas.filter((l) => l.situacao === parametros[0] && Number(l.estoque) > 0);
    }
    if (sql.includes(`FROM ${TABELA_PEDIDO} WHERE peecCodigo_Ecommerce = ?`)) {
      const [codigo, canal, parceiro, fili] = parametros;
      return fonte[TABELA_PEDIDO].filter((p) => p.peecCodigo_Ecommerce === codigo && p.peecCanal === canal && p.peecParceiro === parceiro && p.filiCodigo === fili);
    }
    // Situação (com o JOIN na filial logada) e a leitura com trava do cancelamento.
    if (/FROM pedido_ecommerce p\s+JOIN view_ecommerce_delivery_filial_logada/.test(sql) || sql.includes(`FROM ${TABELA_PEDIDO} WHERE Codigo = ?`)) {
      const [codigo, fili, parceiro] = parametros;
      const daFilial = !sql.includes('JOIN') || (filial && filial.codigo_filial === fili);
      return daFilial ? fonte[TABELA_PEDIDO].filter((p) => p.Codigo === codigo && p.filiCodigo === fili && p.peecParceiro === parceiro) : [];
    }
    throw new Error(`consulta inesperada: ${sql}`);
  };

  /** UPDATE t SET a = 'x', b = NOW() WHERE c = ? AND d = 'y': o que os comandos do conector usam. */
  const atualizar = (sql: string, parametros: unknown[], linhasDaTabela: Linha[]): number => {
    const [, sets, condicoes] = /\bSET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i.exec(sql) ?? [];
    let p = 0;
    const valor = (token: string) => (token === '?' ? parametros[p++] : /^'.*'$/.test(token) ? token.slice(1, -1) : `<${token}>`);
    const mudancas = lista(sets).map((s) => s.split('=').map((t) => t.trim())).map(([c, t]) => [c, valor(t)] as const);
    const filtros = condicoes.split(/\s+AND\s+/i).map((s) => s.split('=').map((t) => t.trim())).map(([c, t]) => [c, valor(t)] as const);
    const alvo = linhasDaTabela.filter((l) => filtros.every(([c, v]) => l[c] === v));
    for (const l of alvo) for (const [c, v] of mudancas) l[c] = v;
    return alvo.length;
  };

  return {
    consultas,
    gravacoes,
    tabelas,
    async consultar(operacao, sql, parametros = []) {
      consultas.push({ operacao, sql, parametros });
      conferirAcesso();
      return ler(sql, parametros, tabelas);
    },
    async gravar(operacao, liberadas, passos) {
      conferirAcesso();
      // Transação: grava numa cópia (linhas copiadas também, por causa do UPDATE) e só troca no fim, se deu certo.
      const copiar = (t: keyof TabelasPedido) => tabelas[t].map((l) => ({ ...l }));
      const copia: TabelasPedido = { [TABELA_PEDIDO]: copiar(TABELA_PEDIDO), [TABELA_ITENS]: copiar(TABELA_ITENS), [TABELA_PAGAMENTO]: copiar(TABELA_PAGAMENTO) };
      try {
        const resultado = await passos({
          async consultar(sql, parametros = []) {
            consultas.push({ operacao, sql, parametros });
            return ler(sql, parametros, copia);
          },
          async executar(sql, parametros = []) {
            conferirGravacao(sql, liberadas);
            gravacoes.push({ operacao, sql, parametros });
            // Como o cliente MySQL de verdade: o erro do driver chega já traduzido.
            if (opcoes.falharEm && sql.includes(opcoes.falharEm)) throw traduzirErroMysql(Object.assign(new Error('Column cannot be null'), { code: 'ER_BAD_NULL_ERROR' }));
            const tabela = tabelaGravada(sql) as keyof TabelasPedido;
            if (/^\s*UPDATE/i.test(sql)) return { idInserido: 0, linhasAfetadas: atualizar(sql, parametros, copia[tabela]) };
            const novas = linhasDoInsert(sql, parametros);
            let idInserido = 0;
            for (const l of novas) {
              if (tabela === TABELA_PEDIDO) {
                // AUTO_INCREMENT único no servidor (as filiais dividem a mesma sequência).
                idInserido = 107_834 + copia[TABELA_PEDIDO].length;
                l.Codigo = idInserido;
              }
              copia[tabela].push(l);
            }
            return { idInserido, linhasAfetadas: novas.length };
          },
        });
        for (const t of [TABELA_PEDIDO, TABELA_ITENS, TABELA_PAGAMENTO] as const) tabelas[t].splice(0, tabelas[t].length, ...copia[t]);
        gravacoes.push({ operacao, sql: 'COMMIT', parametros: [] });
        return resultado;
      } catch (e) {
        gravacoes.push({ operacao, sql: 'ROLLBACK', parametros: [] });
        throw e;
      }
    },
  };
}
