import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../comum/prisma.service';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { Cliente, EnderecoContato, SessaoCompleta } from './tipos';

// Histórico do cliente da loja pelo telefone: endereços usados e últimos pedidos ("pedir de novo").
// Fica por loja: um cliente de uma loja nunca aparece para outra.

const MAX_ENDERECOS = 5;
const MAX_PEDIDOS = 5;
const ESPERA_PLATAFORMA_MS = 3000;

export interface EnderecoSalvo {
  cep: string;
  estado: string;
  cidade: string;
  bairro: string;
  rua: string;
  numero: string;
  complemento: string;
  referencia: string;
}

export interface ItemDePedidoAnterior {
  produtoId: string;
  variacaoId: string | null;
  sku: string;
  nome: string;
  variacaoNome: string | null;
  quantidade: number;
}

export interface PedidoAnterior {
  data: string;
  total: number;
  itens: ItemDePedidoAnterior[];
}

export interface Historico {
  enderecos: EnderecoSalvo[];
  pedidos: PedidoAnterior[];
}

/** Só dígitos com DDI 55 (o telefone vem da Kentro com DDI, ou digitado no checkout sem). */
export function telefoneChave(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

const cepFormatado = (cep: string) => {
  const d = cep.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
};

function completo(e: Partial<EnderecoSalvo>): EnderecoSalvo {
  return {
    cep: cepFormatado(e.cep ?? ''),
    estado: (e.estado ?? '').toUpperCase(),
    cidade: e.cidade ?? '',
    bairro: e.bairro ?? '',
    rua: e.rua ?? '',
    numero: e.numero ?? '',
    complemento: e.complemento ?? '',
    referencia: e.referencia ?? '',
  };
}

/** Mesmo endereço = mesmo CEP, rua e número (sem acento, caixa ou espaços). */
const chaveEndereco = (e: EnderecoSalvo) =>
  [e.cep.replace(/\D/g, ''), e.rua, e.numero]
    .map((v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ''))
    .join('|');

function semRepetir(enderecos: EnderecoSalvo[]): EnderecoSalvo[] {
  const vistos = new Set<string>();
  return enderecos.filter((e) => (e.rua || e.cep) && !vistos.has(chaveEndereco(e)) && vistos.add(chaveEndereco(e)));
}

@Injectable()
export class ClientesService {
  private readonly logger = new Logger('Clientes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
  ) {}

  /** Depois da finalização: guarda o endereço usado (entrega) e o pedido. Falha aqui não desfaz o pedido. */
  async registrarFinalizacao(lojaId: string, telefoneOriginal: string, sessao: SessaoCompleta): Promise<void> {
    const telefone = telefoneChave(telefoneOriginal) ?? telefoneChave(sessao.cliente.telefone);
    if (!telefone) return;
    const atual = await this.prisma.clienteLoja.findUnique({ where: { lojaId_telefone: { lojaId, telefone } } });
    const enderecosAntes = (atual?.enderecos as unknown as EnderecoSalvo[] | undefined) ?? [];
    const pedidosAntes = (atual?.pedidos as unknown as PedidoAnterior[] | undefined) ?? [];
    const usado = sessao.checkout?.tipo === 'entrega' ? [completo(sessao.checkout.entrega)] : [];
    const pedido: PedidoAnterior = {
      data: sessao.finalizadaEm ?? new Date().toISOString(),
      total: sessao.totais.total,
      itens: sessao.itens.map((i) => ({
        produtoId: i.produtoId,
        variacaoId: i.variacaoId,
        sku: i.sku,
        nome: i.nome,
        variacaoNome: i.variacaoNome,
        quantidade: i.quantidade,
      })),
    };
    const dados = {
      nome: sessao.cliente.nome,
      email: sessao.cliente.email ?? atual?.email ?? null,
      documento: sessao.cliente.documento ?? atual?.documento ?? null,
      enderecos: semRepetir([...usado, ...enderecosAntes]).slice(0, MAX_ENDERECOS) as unknown as Prisma.InputJsonValue,
      pedidos: [pedido, ...pedidosAntes].slice(0, MAX_PEDIDOS) as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.clienteLoja.upsert({
      where: { lojaId_telefone: { lojaId, telefone } },
      create: { lojaId, telefone, ...dados },
      update: dados,
    });
  }

  /**
   * O que mostrar ao cliente do link: endereços (usados na loja, do contato da Kentro e da plataforma, sem repetir)
   * e os pedidos anteriores feitos pelo Kentro Shop.
   */
  async historico(lojaId: string, cliente: Cliente): Promise<Historico> {
    const telefone = telefoneChave(cliente.telefone);
    if (!telefone) return { enderecos: [], pedidos: [] };
    const [salvo, daPlataforma] = await Promise.all([
      this.prisma.clienteLoja.findUnique({ where: { lojaId_telefone: { lojaId, telefone } } }),
      this.enderecosDaPlataforma(lojaId, telefone),
    ]);
    const doContato = cliente.endereco && (cliente.endereco.rua || cliente.endereco.cep) ? [completo(cliente.endereco as EnderecoContato)] : [];
    return {
      enderecos: semRepetir([...((salvo?.enderecos as unknown as EnderecoSalvo[]) ?? []), ...doContato, ...daPlataforma]).slice(0, MAX_ENDERECOS),
      pedidos: (salvo?.pedidos as unknown as PedidoAnterior[]) ?? [],
    };
  }

  /** Endereços que a plataforma conhece (ex.: Shopify com a Admin API). Lento ou com erro: ignora. */
  private async enderecosDaPlataforma(lojaId: string, telefone: string): Promise<EnderecoSalvo[]> {
    try {
      const { conector, ctx } = await this.integracoes.contexto(lojaId);
      if (!conector.capacidades.historicoCliente || !conector.historicoDoCliente) return [];
      let relogio: ReturnType<typeof setTimeout> | undefined;
      const limite = new Promise<null>((resolver) => (relogio = setTimeout(() => resolver(null), ESPERA_PLATAFORMA_MS)));
      const h = await Promise.race([conector.historicoDoCliente(ctx, telefone), limite]).finally(() => clearTimeout(relogio));
      return (h?.enderecos ?? []).map((e) => completo(e));
    } catch (e) {
      this.logger.warn(`histórico da plataforma indisponível: ${e instanceof Error ? e.constructor.name : 'erro'}`);
      return [];
    }
  }
}
