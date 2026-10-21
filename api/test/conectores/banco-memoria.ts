import { VIEW_FILIAL_LOGADA, VIEW_PRODUTOS } from '../../src/conectores/automatiza/automatiza.conector';
import { ClienteBanco, Linha } from '../../src/conectores/nucleo/banco';
import { CredencialInvalida, PlataformaIndisponivel } from '../../src/conectores/nucleo/erros';

// Banco do ERP Automatiza em memória: responde às consultas do conector como as views responderiam.
// Dados sintéticos.

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

export interface OpcoesBancoMemoria {
  linhas?: Linha[];
  filial?: Linha | null;
  /** Simula o banco fora do ar. */
  fora?: boolean;
}

export interface BancoMemoria extends ClienteBanco {
  consultas: { operacao: string; sql: string; parametros: unknown[] }[];
}

/** Cliente de banco falso para as credenciais dadas: senha diferente de "certa" é recusada como no MySQL. */
export function bancoEmMemoria(credenciais: Record<string, string>, opcoes: OpcoesBancoMemoria = {}): BancoMemoria {
  const linhas = opcoes.linhas ?? LINHAS_VIEW;
  const filial = opcoes.filial === undefined ? { codigo_filial: 7, filial_fantasia: 'FARMACIA TESTE - LOJA07' } : opcoes.filial;
  const consultas: BancoMemoria['consultas'] = [];
  return {
    consultas,
    async consultar(operacao, sql, parametros = []) {
      consultas.push({ operacao, sql, parametros });
      if (opcoes.fora) throw new PlataformaIndisponivel();
      if (credenciais.senha !== 'certa') throw new CredencialInvalida();
      if (sql.includes(VIEW_FILIAL_LOGADA)) return filial ? [filial] : [];
      if (sql.includes(VIEW_PRODUTOS)) {
        // Como o WHERE do conector: situação pedida e estoque positivo.
        return linhas.filter((l) => l.situacao === parametros[0] && Number(l.estoque) > 0);
      }
      throw new Error(`consulta inesperada: ${sql}`);
    },
  };
}
