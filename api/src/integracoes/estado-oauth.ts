import { createHmac, timingSafeEqual } from 'node:crypto';

// "state" do OAuth: diz de qual loja é a autorização. Assinado com a chave mestra e com validade,
// para que ninguém conecte a própria conta da plataforma numa loja alheia (nem reaproveite um link velho).

export const VALIDADE_ESTADO_MS = 30 * 60_000;

export interface EstadoOAuth {
  lojaId: string;
  plataforma: string;
}

const assinatura = (dados: string, chave: Buffer) => createHmac('sha256', chave).update(dados).digest('base64url');

export function assinarEstado(estado: EstadoOAuth, chave: Buffer, agora = Date.now()): string {
  const dados = Buffer.from(JSON.stringify({ l: estado.lojaId, p: estado.plataforma, e: agora + VALIDADE_ESTADO_MS })).toString('base64url');
  return `${dados}.${assinatura(dados, chave)}`;
}

/** null = adulterado, de outra plataforma ou vencido. */
export function lerEstado(valor: string | undefined, plataforma: string, chave: Buffer, agora = Date.now()): EstadoOAuth | null {
  const [dados, recebida] = String(valor ?? '').split('.');
  if (!dados || !recebida) return null;
  const esperada = Buffer.from(assinatura(dados, chave));
  const veio = Buffer.from(recebida);
  if (veio.length !== esperada.length || !timingSafeEqual(veio, esperada)) return null;
  try {
    const { l, p, e } = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8'));
    if (typeof l !== 'string' || p !== plataforma || typeof e !== 'number' || e < agora) return null;
    return { lojaId: l, plataforma: p };
  } catch {
    return null;
  }
}
