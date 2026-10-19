import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Inject, Injectable, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { CacheCatalogo } from './cache-catalogo';

// Webhooks da Nuvemshop: os obrigatórios de LGPD (cadastrados no painel de parceiros) e os que o Kentro Shop
// registra ao conectar a loja (produto alterado, app desinstalado). A Nuvemshop assina o corpo com o Client Secret
// do app (cabeçalho x-linkedstore-hmac-sha256).

type Corpo = Record<string, unknown>;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** Telefone como o Kentro Shop guarda (só dígitos, com DDI 55): "+55 (38) 98888-7777" e "38988887777". */
function telefones(bruto: unknown): string[] {
  const d = texto(bruto).replace(/\D/g, '');
  if (!d) return [];
  return d.length === 10 || d.length === 11 ? [d, `55${d}`] : [d];
}

@Injectable()
export class ContasNuvemshop {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheCatalogo,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /** Corpo assinado pela Nuvemshop; qualquer outro é recusado. */
  conferir(req: RawBodyRequest<Request>): Corpo {
    if (!this.config.nuvemshop) throw new ErroApi(503, 'NUVEMSHOP_NAO_CONFIGURADA', 'O app da Nuvemshop não está configurado.');
    const recebida = texto(req.header('x-linkedstore-hmac-sha256'));
    const digest = createHmac('sha256', this.config.nuvemshop.clientSecret)
      .update(req.rawBody ?? Buffer.alloc(0))
      .digest();
    // A documentação mostra o hex (hash_hmac do PHP); aceita também o base64.
    const veio = Buffer.from(/^[0-9a-f]{64}$/i.test(recebida) ? recebida.toLowerCase() : recebida);
    const valida = [digest.toString('hex'), digest.toString('base64')].some((esperada) => {
      const a = Buffer.from(esperada);
      return a.length === veio.length && timingSafeEqual(a, veio);
    });
    if (!valida) throw new ErroApi(401, 'ASSINATURA_INVALIDA', 'Assinatura do webhook inválida.');
    return req.body && typeof req.body === 'object' ? (req.body as Corpo) : {};
  }

  /** Lojas do Kentro Shop ligadas a essa conta da Nuvemshop (store_id). */
  async lojasDa(storeId: string): Promise<string[]> {
    if (!/^\d+$/.test(storeId)) return [];
    const linhas = await this.prisma.integracao.findMany({ where: { plataforma: 'nuvemshop', idExterno: storeId }, select: { lojaId: true } });
    return linhas.map((l) => l.lojaId);
  }

  /** O token já não vale: apaga a integração e a loja volta a pedir integração. */
  async desconectar(lojas: string[]): Promise<void> {
    if (!lojas.length) return;
    await this.prisma.$transaction([
      this.prisma.integracao.deleteMany({ where: { lojaId: { in: lojas }, plataforma: 'nuvemshop' } }),
      this.prisma.loja.updateMany({ where: { id: { in: lojas }, status: 'ativa' }, data: { status: 'pendente_integracao' } }),
    ]);
    for (const lojaId of lojas) this.cache.invalidar(lojaId);
  }

  limparCache(lojas: string[]): void {
    for (const lojaId of lojas) this.cache.invalidar(lojaId);
  }

  /** Apaga o histórico (endereços e pedidos) do cliente nas lojas, pelo e-mail ou telefone. */
  async apagarCliente(lojas: string[], cliente: Corpo): Promise<void> {
    const email = texto(cliente.email).toLowerCase();
    const fones = telefones(cliente.phone);
    const condicoes = [...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []), ...(fones.length ? [{ telefone: { in: fones } }] : [])];
    if (lojas.length && condicoes.length) await this.prisma.clienteLoja.deleteMany({ where: { lojaId: { in: lojas }, OR: condicoes } });
  }
}

/** Webhooks obrigatórios (LGPD), cadastrados no painel de parceiros da Nuvemshop. */
@Controller('v1/nuvemshop/lgpd')
@UseGuards(ThrottlerGuard)
@Throttle({ publico: { limit: 120, ttl: 60_000 } })
@SkipThrottle({ registro: true })
export class NuvemshopLgpdController {
  constructor(private readonly contas: ContasNuvemshop) {}

  /** A loja desinstalou o app e pediu a exclusão dos dados dela. */
  @Post('store-redact')
  @HttpCode(200)
  async loja(@Req() req: RawBodyRequest<Request>) {
    const corpo = this.contas.conferir(req);
    await this.contas.desconectar(await this.contas.lojasDa(texto(corpo.store_id)));
    return {};
  }

  /** Pedido de exclusão de um cliente: apaga o histórico dele nas lojas ligadas a essa conta. */
  @Post('customers-redact')
  @HttpCode(200)
  async cliente(@Req() req: RawBodyRequest<Request>) {
    const corpo = this.contas.conferir(req);
    const cliente = corpo.customer && typeof corpo.customer === 'object' ? (corpo.customer as Corpo) : {};
    await this.contas.apagarCliente(await this.contas.lojasDa(texto(corpo.store_id)), cliente);
    return {};
  }

  /**
   * Pedido de dados de um cliente. O que o Kentro Shop guarda do cliente (endereços e pedidos feitos pelo catálogo)
   * vem da conversa na Kentro e fica com a própria loja; o que é da Nuvemshop está na Nuvemshop.
   */
  @Post('customers-data-request')
  @HttpCode(200)
  dados(@Req() req: RawBodyRequest<Request>) {
    this.contas.conferir(req);
    return {};
  }
}

/** Webhooks que o Kentro Shop registra ao conectar a loja (EVENTOS_WEBHOOK do conector). */
@Controller('v1/nuvemshop/webhooks')
@UseGuards(ThrottlerGuard)
@Throttle({ publico: { limit: 600, ttl: 60_000 } })
@SkipThrottle({ registro: true })
export class NuvemshopWebhooksController {
  constructor(private readonly contas: ContasNuvemshop) {}

  @Post()
  @HttpCode(200)
  async evento(@Req() req: RawBodyRequest<Request>) {
    const corpo = this.contas.conferir(req);
    const evento = texto(corpo.event);
    const lojas = await this.contas.lojasDa(texto(corpo.store_id));
    if (evento === 'app/uninstalled') await this.contas.desconectar(lojas);
    // Produto criado, alterado ou apagado: o próximo acesso lê de novo na Nuvemshop.
    else if (evento.startsWith('product/')) this.contas.limparCache(lojas);
    return {};
  }
}
