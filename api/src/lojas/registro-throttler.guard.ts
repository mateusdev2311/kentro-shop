import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Limite do registro por IP + instância da Kentro.
 * As extensões chamam a API por omni.http.request, que sai do backend da Kentro: o IP é o
 * mesmo para todas as instâncias. Só por IP, uma instância esgotaria o cadastro de todas.
 * O cabeçalho pode ser forjado, mas isso só permite contornar o limite, não bloquear outra
 * instância a partir de outro IP.
 */
@Injectable()
export class RegistroThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const instancia = String(req.headers['x-kentro-instancia'] ?? '').trim().toLowerCase().slice(0, 200);
    return `${req.ip}|${instancia}`;
  }
}
