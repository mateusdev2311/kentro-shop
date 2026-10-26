import { Injectable } from '@nestjs/common';
import { Loja } from '@prisma/client';
import { gerarSegredo, hashSegredo, TipoSegredo } from '../comum/cripto';
import { PrismaService } from '../comum/prisma.service';

export type Papel = 'admin' | 'atendimento';

const CAMPO_DO_HASH: Record<TipoSegredo, 'chaveAdminHash' | 'chaveAtendimentoHash' | 'tokenMcpHash'> = {
  admin: 'chaveAdminHash',
  atendimento: 'chaveAtendimentoHash',
  mcp: 'tokenMcpHash',
};

@Injectable()
export class LojasService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(nome?: string): Promise<{ lojaId: string; chaveAdmin: string; chaveAtendimento: string; tokenMcp: string }> {
    const chaveAdmin = gerarSegredo('admin');
    const chaveAtendimento = gerarSegredo('atendimento');
    const tokenMcp = gerarSegredo('mcp');
    const loja = await this.prisma.loja.create({
      data: {
        nome: nome?.trim() || null,
        chaveAdminHash: hashSegredo(chaveAdmin),
        chaveAtendimentoHash: hashSegredo(chaveAtendimento),
        tokenMcpHash: hashSegredo(tokenMcp),
      },
    });
    return { lojaId: loja.id, chaveAdmin, chaveAtendimento, tokenMcp };
  }

  /** Plataforma integrada (ex.: "kentro", "shopify") ou null. */
  async plataforma(lojaId: string): Promise<string | null> {
    const integracao = await this.prisma.integracao.findUnique({ where: { lojaId }, select: { plataforma: true } });
    return integracao?.plataforma ?? null;
  }

  /** Filas da Kentro que usam este catálogo (o painel do atendimento só aparece nelas). Vazio = todas. */
  async filasAtendimento(lojaId: string): Promise<number[]> {
    const config = await this.prisma.configLoja.findUnique({ where: { lojaId }, select: { filasAtendimento: true } });
    return config?.filasAtendimento ?? [];
  }

  async buscarPorChave(chave: string): Promise<{ loja: Loja; papel: Papel } | null> {
    const hash = hashSegredo(chave);
    const loja = await this.prisma.loja.findFirst({
      where: { OR: [{ chaveAdminHash: hash }, { chaveAtendimentoHash: hash }] },
    });
    if (!loja) return null;
    return { loja, papel: loja.chaveAdminHash === hash ? 'admin' : 'atendimento' };
  }

  /** Loja do token MCP (assistente de IA da Kentro). */
  async buscarPorTokenMcp(token: string): Promise<Loja | null> {
    return this.prisma.loja.findFirst({ where: { tokenMcpHash: hashSegredo(token) } });
  }

  async rotacionar(lojaId: string, tipo: TipoSegredo): Promise<string> {
    const chave = gerarSegredo(tipo);
    await this.prisma.loja.update({ where: { id: lojaId }, data: { [CAMPO_DO_HASH[tipo]]: hashSegredo(chave) } });
    return chave;
  }
}
