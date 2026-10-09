import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Loja, Prisma } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { SuperadminGuard } from './superadmin.guard';

export class AtualizarLojaDto {
  @IsOptional()
  @IsIn(['pendente_integracao', 'ativa', 'bloqueada'])
  status?: 'pendente_integracao' | 'ativa' | 'bloqueada';

  @IsOptional()
  @IsString()
  @Length(1, 40)
  plano?: string;

  @IsOptional()
  @IsObject()
  limites?: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publica({ id, nome, status, plano, limites, criadoEm }: Loja) {
  return { id, nome, status, plano, limites, criadoEm };
}

@Controller('v1/admin/lojas')
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar() {
    const lojas = await this.prisma.loja.findMany({ orderBy: { criadoEm: 'desc' } });
    return lojas.map(publica);
  }

  @Patch(':id')
  async atualizar(@Param('id') id: string, @Body() dto: AtualizarLojaDto) {
    const naoEncontrada = new ErroApi(404, 'NAO_ENCONTRADO', 'Loja não encontrada.');
    if (!UUID.test(id)) throw naoEncontrada;
    try {
      const loja = await this.prisma.loja.update({
        where: { id },
        data: { status: dto.status, plano: dto.plano, limites: dto.limites as Prisma.InputJsonValue | undefined },
      });
      return publica(loja);
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') throw naoEncontrada;
      throw erro;
    }
  }
}
