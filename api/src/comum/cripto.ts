import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_TAG = 16;

// AES-256-GCM com IV de 12 bytes; a tag de autenticação vai anexada ao fim do cifrado.
export function cifrar(texto: string, chaveMestra: Buffer): { cifrado: Buffer; iv: Buffer } {
  const iv = randomBytes(12);
  const cifra = createCipheriv(ALGORITMO, chaveMestra, iv);
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final(), cifra.getAuthTag()]);
  return { cifrado, iv };
}

export function decifrar(cifrado: Buffer, iv: Buffer, chaveMestra: Buffer): string {
  const decifra = createDecipheriv(ALGORITMO, chaveMestra, iv);
  decifra.setAuthTag(cifrado.subarray(cifrado.length - TAMANHO_TAG));
  return Buffer.concat([decifra.update(cifrado.subarray(0, cifrado.length - TAMANHO_TAG)), decifra.final()]).toString('utf8');
}

const PREFIXOS = { admin: 'ksa_', atendimento: 'ksk_', mcp: 'ksm_' } as const;

export type TipoSegredo = keyof typeof PREFIXOS;

export function gerarSegredo(tipo: TipoSegredo): string {
  return PREFIXOS[tipo] + randomBytes(32).toString('base64url');
}

export function hashSegredo(segredo: string): string {
  return createHash('sha256').update(segredo.trim()).digest('hex');
}

// Compara pelos hashes, que têm tamanho fixo, para não vazar o tamanho nem o conteúdo pelo tempo.
export function compararSeguro(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
