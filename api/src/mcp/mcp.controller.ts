import { All, Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Loja } from '@prisma/client';
import { Request, Response } from 'express';
import { LojasService } from '../lojas/lojas.service';
import { FERRAMENTAS, FerramentasMcpService, INSTRUCOES } from './ferramentas.service';
import { responderCorpo, ServidorMcp } from './protocolo';

const NAO_AUTORIZADO = -32001;

/**
 * Servidor MCP da loja para a assistente de IA da Kentro (spec 11.1): POST /mcp, Bearer = token MCP da loja.
 * Sem estado: não emite Mcp-Session-Id e não abre o canal de notificações.
 */
@Controller('mcp')
export class McpController {
  constructor(
    private readonly lojas: LojasService,
    private readonly ferramentas: FerramentasMcpService,
  ) {}

  @Post()
  async mensagem(@Req() req: Request, @Body() corpo: unknown, @Res() res: Response): Promise<void> {
    const token = /^Bearer\s+(.+)$/i.exec(req.header('Authorization') ?? '')?.[1]?.trim();
    const loja = token ? await this.lojas.buscarPorTokenMcp(token) : null;
    if (!loja) {
      res.status(401).setHeader('WWW-Authenticate', 'Bearer');
      res.json({ jsonrpc: '2.0', id: null, error: { code: NAO_AUTORIZADO, message: 'Token MCP do Kentro Shop inválido. Gere outro em Kentro Shop — Admin > IA.' } });
      return;
    }
    if (loja.status === 'bloqueada') {
      res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: NAO_AUTORIZADO, message: 'Esta loja está bloqueada no Kentro Shop.' } });
      return;
    }
    const resposta = await responderCorpo(this.servidor(loja), corpo);
    if (!resposta) {
      res.status(202).end();
      return;
    }
    res.status(200).json(resposta);
  }

  /** GET (canal de notificações) e DELETE (fim de sessão) não existem num servidor sem estado. */
  @All()
  outros(@Res() res: Response): void {
    res.status(405).setHeader('Allow', 'POST');
    res.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST.' } });
  }

  private servidor(loja: Loja): ServidorMcp {
    return {
      nome: 'kentro-shop',
      versao: '0.1.0',
      instrucoes: INSTRUCOES,
      ferramentas: FERRAMENTAS,
      chamar: (nome, args) => this.ferramentas.chamar(loja, nome, args),
    };
  }
}
