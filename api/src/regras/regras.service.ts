import { Injectable } from '@nestjs/common';
import { RegraProduto } from '@prisma/client';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { RegraDto } from './dto';

export interface RegraPublica {
  sku: string;
  oculto: boolean;
  selo: string | null;
  m2PorUnidade: number | null;
  rendimentoM2: number | null;
  compreJunto: string[];
}

const publica = ({ sku, oculto, selo, m2PorUnidade, rendimentoM2, compreJunto }: RegraProduto): RegraPublica => ({
  sku,
  oculto,
  selo,
  m2PorUnidade,
  rendimentoM2,
  compreJunto,
});

@Injectable()
export class RegrasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(lojaId: string): Promise<RegraPublica[]> {
    return (await this.prisma.regraProduto.findMany({ where: { lojaId }, orderBy: { sku: 'asc' } })).map(publica);
  }

  async obter(lojaId: string, sku: string): Promise<RegraPublica> {
    const regra = await this.prisma.regraProduto.findUnique({ where: { lojaId_sku: { lojaId, sku } } });
    if (!regra) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Este produto não tem regra cadastrada.');
    return publica(regra);
  }

  /** Regras de vários SKUs numa única consulta (a listagem nunca consulta produto a produto). */
  async porSkus(lojaId: string, skus: string[]): Promise<Map<string, RegraPublica>> {
    if (!skus.length) return new Map();
    const regras = await this.prisma.regraProduto.findMany({ where: { lojaId, sku: { in: skus } } });
    return new Map(regras.map((r) => [r.sku, publica(r)]));
  }

  async salvar(lojaId: string, sku: string, dto: RegraDto): Promise<RegraPublica> {
    const dados = {
      ...(dto.oculto !== undefined ? { oculto: dto.oculto } : {}),
      ...(dto.selo !== undefined ? { selo: dto.selo?.trim() || null } : {}),
      ...(dto.m2PorUnidade !== undefined ? { m2PorUnidade: dto.m2PorUnidade } : {}),
      ...(dto.rendimentoM2 !== undefined ? { rendimentoM2: dto.rendimentoM2 } : {}),
      ...(dto.compreJunto !== undefined ? { compreJunto: [...new Set((dto.compreJunto ?? []).map((s) => s.trim()).filter(Boolean))] } : {}),
    };
    const regra = await this.prisma.regraProduto.upsert({
      where: { lojaId_sku: { lojaId, sku } },
      create: { lojaId, sku, ...dados },
      update: dados,
    });
    return publica(regra);
  }

  async apagar(lojaId: string, sku: string): Promise<void> {
    await this.prisma.regraProduto.deleteMany({ where: { lojaId, sku } });
  }
}
