import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Inject, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';

// Webhooks obrigatórios (LGPD) do app da Nuvemshop, cadastrados no painel de parceiros.
// A Nuvemshop assina o corpo com o Client Secret do app (cabeçalho x-linkedstore-hmac-sha256).

type Corpo = Record<string, unknown>;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** Telefone como o Kentro Shop guarda (só dígitos, com DDI 55): "+55 (38) 98888-7777" e "38988887777". */
function telefones(bruto: unknown): string[] {
  const d = texto(bruto).replace(/\D/g, '');
  if (!d) return [];
  return d.length === 10 || d.length === 11 ? [d, `55${d}`] : [d];
}

@Controller('v1/nuvemshop/lgpd')
@UseGuards(ThrottlerGuard)
@Throttle({ publico: { limit: 120, ttl: 60_000 } })
@SkipThrottle({ registro: true })
export class NuvemshopLgpdController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /** Corpo assinado pela Nuvemshop; qualquer outro é recusado. */
  private conferir(req: RawBodyRequest<Request>): Corpo {
    if (!this.config.nuvemshop) throw new ErroApi(503, 'NUVEMSHOP_NAO_CONFIGURADA', 'O app da Nuvemshop não está configurado.');
    const recebida = texto(req.header('x-linkedstore-hmac-sha256'));
    const hmac = createHmac('sha256', this.config.nuvemshop.clientSecret).update(req.rawBody ?? Buffer.alloc(0));
    const digest = hmac.digest();
    // A documentação mostra o hex (hash_hmac do PHP); aceita também o base64.
    const veio = Buffer.from(/^[0-9a-f]{64}$/i.test(recebida) ? recebida.toLowerCase() : recebida);
    const valida = [digest.toString('hex'), digest.toString('base64')].some((esperada) => {
      const a = Buffer.from(esperada);
      return a.length === veio.length && timingSafeEqual(a, veio);
    });
    if (!valida) throw new ErroApi(401, 'ASSINATURA_INVALIDA', 'Assinatura do webhook inválida.');
    return req.body && typeof req.body === 'object' ? (req.body as Corpo) : {};
  }

  private async lojasDa(storeId: string): Promise<string[]> {
    if (!/^\d+$/.test(storeId)) return [];
    const linhas = await this.prisma.integracao.findMany({ where: { plataforma: 'nuvemshop', idExterno: storeId }, select: { lojaId: true } });
    return linhas.map((l) => l.lojaId);
  }

  /** A loja desinstalou o app: apaga a integração (o token já não vale) e a loja volta a pedir integração. */
  @Post('store-redact')
  @HttpCode(200)
  async loja(@Req() req: RawBodyRequest<Request>) {
    const corpo = this.conferir(req);
    const lojas = await this.lojasDa(texto(corpo.store_id));
    if (lojas.length) {
      await this.prisma.$transaction([
        this.prisma.integracao.deleteMany({ where: { lojaId: { in: lojas }, plataforma: 'nuvemshop' } }),
        this.prisma.loja.updateMany({ where: { id: { in: lojas }, status: 'ativa' }, data: { status: 'pendente_integracao' } }),
      ]);
    }
    return {};
  }

  /** Pedido de exclusão de um cliente: apaga o histórico dele (endereços e pedidos) nas lojas ligadas a essa conta. */
  @Post('customers-redact')
  @HttpCode(200)
  async cliente(@Req() req: RawBodyRequest<Request>) {
    const corpo = this.conferir(req);
    const lojas = await this.lojasDa(texto(corpo.store_id));
    const cliente = corpo.customer && typeof corpo.customer === 'object' ? (corpo.customer as Corpo) : {};
    const email = texto(cliente.email).toLowerCase();
    const fones = telefones(cliente.phone);
    const condicoes = [...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []), ...(fones.length ? [{ telefone: { in: fones } }] : [])];
    if (lojas.length && condicoes.length) {
      await this.prisma.clienteLoja.deleteMany({ where: { lojaId: { in: lojas }, OR: condicoes } });
    }
    return {};
  }

  /**
   * Pedido de dados de um cliente. O Kentro Shop não lê clientes nem pedidos da Nuvemshop (a permissão do app é
   * só de produtos); o que guarda do cliente vem da conversa na Kentro e fica com a própria loja.
   */
  @Post('customers-data-request')
  @HttpCode(200)
  dados(@Req() req: RawBodyRequest<Request>) {
    this.conferir(req);
    return {};
  }
}
