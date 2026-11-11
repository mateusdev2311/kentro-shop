import { Injectable } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { Checkout, Cliente, PedidoNaLoja, Totais } from '../sessoes/tipos';

// Relatórios de vendas da aba Relatórios do admin. Os dias são os de Brasília (UTC−3, sem horário de verão desde 2019).

const FUSO_MS = 3 * 3_600_000;
const DIA_MS = 86_400_000;
const DIAS_PADRAO = 30;
export const MAX_DIAS = 366;
const MAX_LISTA = 200;
const MAX_PRODUTOS = 15;
/** Proteção de memória: a soma do período lê os atendimentos finalizados um a um. */
const MAX_FINALIZADOS = 50_000;
const CANCELADOS = new Set(['CANCELADO', 'CANCELLED', 'CANCELED']);

export type Origem = 'atendente' | 'ia' | 'ura';
const ORIGENS: Origem[] = ['ia', 'ura', 'atendente'];

export interface Numeros {
  /** Links gerados (atendimentos novos) no período. */
  links: number;
  /** Desses links, quantos viraram pedido (até agora). */
  convertidos: number;
  /** Pedidos finalizados no período, sem os cancelados. */
  pedidos: number;
  valor: number;
}

export interface Relatorio {
  periodo: { de: string; ate: string; dias: number };
  resumo: Numeros & {
    abertos: number;
    ticketMedio: number;
    cancelados: number;
    /** Valor dos cancelados (fora do valor em pedidos). */
    valorCancelado: number;
    entrega: number;
    retirada: number;
    /** Pedidos que entraram no sistema da loja (ERP, Nuvemshop…). */
    naLoja: number;
  };
  porOrigem: (Numeros & { origem: Origem })[];
  /** Atendentes que geraram links ou fecharam pedidos pelo painel. */
  porAtendente: (Numeros & { nome: string; fechadosNoPainel: number; valorNoPainel: number })[];
  quemFinalizou: { cliente: { pedidos: number; valor: number }; atendente: { pedidos: number; valor: number } };
  porDia: { dia: string; links: number; pedidos: number; valor: number }[];
  produtos: { nome: string; quantidade: number; valor: number; pedidos: number }[];
  pedidos: {
    sessaoId: string;
    chatId: string;
    em: string;
    cliente: string;
    telefone: string;
    tipo: 'entrega' | 'retirada' | '';
    total: number;
    origem: Origem;
    geradoPor: string;
    finalizadaPor: 'cliente' | 'atendente';
    finalizadaPorNome: string;
    pedidoNumero: string;
    situacao: string;
    cancelado: boolean;
  }[];
  /** A lista de pedidos foi cortada em MAX_LISTA (os números continuam completos). */
  listaCortada: boolean;
}

const centavos = (n: number) => Math.round(n * 100) / 100;
const SEM_NOME = 'Sem nome';

/** Dia de Brasília ("2026-11-11") de um instante. */
export function diaDe(data: Date): string {
  return new Date(data.getTime() - FUSO_MS).toISOString().slice(0, 10);
}

/** Início do dia de Brasília, em UTC. */
function inicioDoDia(dia: string): Date {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + FUSO_MS);
}

function diaValido(dia: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) && !Number.isNaN(Date.parse(`${dia}T00:00:00Z`)) && new Date(`${dia}T00:00:00Z`).toISOString().startsWith(dia);
}

/** Período pedido (dias inclusivos de Brasília); sem datas, os últimos 30 dias até hoje. */
export function periodo(de?: string, ate?: string, agora = new Date()): { de: string; ate: string; dias: number; inicio: Date; fim: Date } {
  const fimDia = ate || diaDe(agora);
  if (!diaValido(fimDia) || (de && !diaValido(de))) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'Data inválida. Use o formato AAAA-MM-DD.');
  const inicioDia = de || diaDe(new Date(inicioDoDia(fimDia).getTime() - (DIAS_PADRAO - 1) * DIA_MS));
  const inicio = inicioDoDia(inicioDia);
  const fim = new Date(inicioDoDia(fimDia).getTime() + DIA_MS);
  const dias = Math.round((fim.getTime() - inicio.getTime()) / DIA_MS);
  if (dias < 1) throw new ErroApi(400, 'ENTRADA_INVALIDA', 'A data inicial precisa ser antes da final.');
  if (dias > MAX_DIAS) throw new ErroApi(400, 'ENTRADA_INVALIDA', `O período pode ter até ${MAX_DIAS} dias.`);
  return { de: inicioDia, ate: fimDia, dias, inicio, fim };
}

const vazio = (): Numeros => ({ links: 0, convertidos: 0, pedidos: 0, valor: 0 });

@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  async gerar(lojaId: string, de?: string, ate?: string): Promise<Relatorio> {
    const p = periodo(de, ate);
    const criadosNoPeriodo = { lojaId, criadaEm: { gte: p.inicio, lt: p.fim } };

    const [links, convertidos, abertos, finalizadas, linksPorDia, produtos] = await Promise.all([
      this.prisma.sessao.groupBy({ by: ['origem', 'geradoPor'], where: criadosNoPeriodo, _count: { _all: true } }),
      this.prisma.sessao.groupBy({ by: ['origem', 'geradoPor'], where: { ...criadosNoPeriodo, finalizadaEm: { not: null } }, _count: { _all: true } }),
      this.prisma.sessao.count({ where: { ...criadosNoPeriodo, abertaEm: { not: null } } }),
      this.prisma.sessao.findMany({
        where: { lojaId, finalizadaEm: { gte: p.inicio, lt: p.fim } },
        orderBy: { finalizadaEm: 'desc' },
        take: MAX_FINALIZADOS,
        select: {
          id: true,
          chatId: true,
          cliente: true,
          totais: true,
          checkout: true,
          pedido: true,
          origem: true,
          geradoPor: true,
          finalizadaPor: true,
          finalizadaPorNome: true,
          finalizadaEm: true,
        },
      }),
      this.prisma.$queryRaw<{ dia: string; n: number }[]>`
        SELECT to_char(criada_em - interval '3 hours', 'YYYY-MM-DD') AS dia, COUNT(*)::int AS n
          FROM sessoes WHERE loja_id = ${lojaId}::uuid AND criada_em >= ${p.inicio} AND criada_em < ${p.fim}
         GROUP BY 1`,
      this.prisma.$queryRaw<{ nome: string; quantidade: number; valor: number; pedidos: number }[]>`
        SELECT MAX(i.nome) || COALESCE(' (' || MAX(i.variacao_nome) || ')', '') AS nome,
               SUM(i.quantidade)::int AS quantidade,
               SUM(i.preco_unitario * i.quantidade)::float8 AS valor,
               COUNT(DISTINCT i.sessao_id)::int AS pedidos
          FROM itens_carrinho i JOIN sessoes s ON s.id = i.sessao_id
         WHERE s.loja_id = ${lojaId}::uuid AND s.finalizada_em >= ${p.inicio} AND s.finalizada_em < ${p.fim}
           AND UPPER(COALESCE(s.pedido ->> 'status', '')) NOT IN ('CANCELADO', 'CANCELLED', 'CANCELED')
         GROUP BY i.produto_id, i.variacao_id
         ORDER BY valor DESC, quantidade DESC
         LIMIT ${MAX_PRODUTOS}`,
    ]);

    const porOrigem = new Map<Origem, Numeros>(ORIGENS.map((o) => [o, vazio()]));
    const atendentes = new Map<string, Numeros & { fechadosNoPainel: number; valorNoPainel: number }>();
    const doAtendente = (nome: string) => {
      const chave = nome.trim() || SEM_NOME;
      let linha = atendentes.get(chave);
      if (!linha) atendentes.set(chave, (linha = { ...vazio(), fechadosNoPainel: 0, valorNoPainel: 0 }));
      return linha;
    };
    const origemDe = (o: string): Origem => (o === 'ia' || o === 'ura' ? o : 'atendente');

    for (const g of links) {
      porOrigem.get(origemDe(g.origem))!.links += g._count._all;
      if (origemDe(g.origem) === 'atendente') doAtendente(g.geradoPor).links += g._count._all;
    }
    for (const g of convertidos) {
      porOrigem.get(origemDe(g.origem))!.convertidos += g._count._all;
      if (origemDe(g.origem) === 'atendente') doAtendente(g.geradoPor).convertidos += g._count._all;
    }

    const resumo: Relatorio['resumo'] = { ...vazio(), abertos, ticketMedio: 0, cancelados: 0, valorCancelado: 0, entrega: 0, retirada: 0, naLoja: 0 };
    const quemFinalizou: Relatorio['quemFinalizou'] = { cliente: { pedidos: 0, valor: 0 }, atendente: { pedidos: 0, valor: 0 } };
    const diaria = new Map<string, { links: number; pedidos: number; valor: number }>();
    for (let t = p.inicio.getTime(); t < p.fim.getTime(); t += DIA_MS) diaria.set(diaDe(new Date(t)), { links: 0, pedidos: 0, valor: 0 });
    for (const l of linksPorDia) {
      const d = diaria.get(l.dia);
      if (d) d.links = Number(l.n);
    }

    const lista: Relatorio['pedidos'] = [];
    for (const s of finalizadas) {
      const totais = s.totais as unknown as Totais;
      const checkout = s.checkout as unknown as Checkout | null;
      const pedido = s.pedido as unknown as PedidoNaLoja | null;
      const cliente = s.cliente as unknown as Cliente;
      const total = Number(totais?.total) || 0;
      const cancelado = CANCELADOS.has(String(pedido?.status ?? '').toUpperCase());
      const origem = origemDe(s.origem);
      const finalizadaPor = s.finalizadaPor === 'atendente' ? 'atendente' : 'cliente';
      if (lista.length < MAX_LISTA) {
        lista.push({
          sessaoId: s.id,
          chatId: s.chatId,
          em: s.finalizadaEm!.toISOString(),
          cliente: cliente?.nome ?? '',
          telefone: cliente?.telefone ?? '',
          tipo: checkout?.tipo ?? '',
          total,
          origem,
          geradoPor: s.geradoPor,
          finalizadaPor,
          finalizadaPorNome: s.finalizadaPorNome,
          pedidoNumero: pedido?.numero ?? '',
          situacao: cancelado ? 'Cancelado' : (pedido?.descricao ?? ''),
          cancelado,
        });
      }
      if (cancelado) {
        resumo.cancelados += 1;
        resumo.valorCancelado += total;
        continue;
      }
      resumo.pedidos += 1;
      resumo.valor += total;
      if (checkout?.tipo === 'entrega') resumo.entrega += 1;
      if (checkout?.tipo === 'retirada') resumo.retirada += 1;
      if (pedido) resumo.naLoja += 1;
      const o = porOrigem.get(origem)!;
      o.pedidos += 1;
      o.valor += total;
      if (origem === 'atendente') {
        const a = doAtendente(s.geradoPor);
        a.pedidos += 1;
        a.valor += total;
      }
      quemFinalizou[finalizadaPor].pedidos += 1;
      quemFinalizou[finalizadaPor].valor += total;
      if (finalizadaPor === 'atendente') {
        const a = doAtendente(s.finalizadaPorNome);
        a.fechadosNoPainel += 1;
        a.valorNoPainel += total;
      }
      const d = diaria.get(diaDe(s.finalizadaEm!));
      if (d) {
        d.pedidos += 1;
        d.valor += total;
      }
    }

    resumo.links = links.reduce((n, g) => n + g._count._all, 0);
    resumo.convertidos = convertidos.reduce((n, g) => n + g._count._all, 0);
    resumo.valor = centavos(resumo.valor);
    resumo.valorCancelado = centavos(resumo.valorCancelado);
    resumo.ticketMedio = resumo.pedidos ? centavos(resumo.valor / resumo.pedidos) : 0;
    quemFinalizou.cliente.valor = centavos(quemFinalizou.cliente.valor);
    quemFinalizou.atendente.valor = centavos(quemFinalizou.atendente.valor);

    return {
      periodo: { de: p.de, ate: p.ate, dias: p.dias },
      resumo,
      porOrigem: ORIGENS.map((origem) => {
        const n = porOrigem.get(origem)!;
        return { origem, ...n, valor: centavos(n.valor) };
      }),
      porAtendente: [...atendentes.entries()]
        .map(([nome, n]) => ({ nome, ...n, valor: centavos(n.valor), valorNoPainel: centavos(n.valorNoPainel) }))
        .sort((a, b) => b.valor + b.valorNoPainel - (a.valor + a.valorNoPainel) || b.links - a.links || a.nome.localeCompare(b.nome, 'pt-BR')),
      quemFinalizou,
      porDia: [...diaria.entries()].map(([dia, n]) => ({ dia, ...n, valor: centavos(n.valor) })),
      produtos: produtos.map((r) => ({ nome: r.nome, quantidade: Number(r.quantidade), valor: centavos(Number(r.valor)), pedidos: Number(r.pedidos) })),
      pedidos: lista,
      listaCortada: finalizadas.length > MAX_LISTA,
    };
  }
}
