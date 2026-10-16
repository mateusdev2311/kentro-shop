import { Injectable } from '@nestjs/common';
import { PrismaService } from '../comum/prisma.service';

export interface LojaRetirada {
  id: string;
  nome: string;
  endereco: string;
  horario: string;
  orientacoes: string;
}

export type RegraFrete =
  | { regra: 'a_combinar'; prazo?: string }
  | { regra: 'fixo'; valor: number; prazo?: string }
  | { regra: 'gratis_acima_de'; valor: number; minimo: number; prazo?: string };

export interface ConfigEfetiva {
  tema: { nome: string; corPrimaria: string; logoUrl?: string; boasVindas?: string };
  entrega: { habilitada: boolean };
  retirada: { habilitada: boolean };
  lojasRetirada: LojaRetirada[];
  frete: RegraFrete;
  expiracaoLinkDias: number;
  modoPedido: 'handoff' | 'criar_pedido';
  categoriasOcultas: string[];
  urlCapturaKentro: string | null;
}

const COR_PADRAO = '#7C3AED';

type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objeto) : {});

/**
 * Configuração da loja já com os padrões aplicados. Na Fase 1.2 só é lida
 * (entrega habilitada, retirada desabilitada, frete a combinar); a tela de edição vem na 1.3.
 */
@Injectable()
export class ConfigLojaService {
  constructor(private readonly prisma: PrismaService) {}

  async obter(lojaId: string): Promise<ConfigEfetiva> {
    const [loja, gravada] = await Promise.all([
      this.prisma.loja.findUnique({ where: { id: lojaId }, select: { nome: true } }),
      this.prisma.configLoja.findUnique({ where: { lojaId } }),
    ]);
    const tema = objeto(gravada?.tema);
    const entrega = objeto(gravada?.entrega);
    const retirada = objeto(gravada?.retirada);
    const frete = objeto(gravada?.frete);
    return {
      tema: {
        nome: String(tema.nome || loja?.nome || 'Catálogo'),
        corPrimaria: String(tema.corPrimaria || COR_PADRAO),
        ...(tema.logoUrl ? { logoUrl: String(tema.logoUrl) } : {}),
        ...(tema.boasVindas ? { boasVindas: String(tema.boasVindas) } : {}),
      },
      entrega: { habilitada: entrega.habilitada !== false },
      retirada: { habilitada: retirada.habilitada === true },
      lojasRetirada: Array.isArray(gravada?.lojasRetirada) ? (gravada!.lojasRetirada as unknown as LojaRetirada[]) : [],
      frete: frete.regra ? (frete as unknown as RegraFrete) : { regra: 'a_combinar' },
      expiracaoLinkDias: gravada?.expiracaoLinkDias ?? 7,
      modoPedido: gravada?.modoPedido === 'criar_pedido' ? 'criar_pedido' : 'handoff',
      categoriasOcultas: gravada?.categoriasOcultas ?? [],
      urlCapturaKentro: gravada?.urlCapturaKentro ?? null,
    };
  }
}
