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

  async buscarPorChave(chave: string): Promise<{ loja: Loja; papel: Papel } | null> {
    const hash = hashSegredo(chave);
    const loja = await this.prisma.loja.findFirst({
      where: { OR: [{ chaveAdminHash: hash }, { chaveAtendimentoHash: hash }] },
    });
    if (!loja) return null;
    return { loja, papel: loja.chaveAdminHash === hash ? 'admin' : 'atendimento' };
  }

  async rotacionar(lojaId: string, tipo: TipoSegredo): Promise<string> {
    const chave = gerarSegredo(tipo);
    await this.prisma.loja.update({ where: { id: lojaId }, data: { [CAMPO_DO_HASH[tipo]]: hashSegredo(chave) } });
    return chave;
  }
}
