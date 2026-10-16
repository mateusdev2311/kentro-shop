import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PlataformaIndisponivel, RecusadoPelaPlataforma } from './erros';

// Proteção contra SSRF: a API só chama endereços https públicos (o endereço vem do admin da loja).

const NOMES_INTERNOS = /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$)/i;

function ipv4Privado(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local e metadados de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function ipPrivado(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) return ipv4Privado(ip);
  if (versao !== 6) return true;
  const v6 = ip.toLowerCase();
  const mapeado = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ipv4Privado(mapeado[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

/** Validação síncrona ao salvar: https, host público e sem IP privado literal. */
export function enderecoPublicoHttps(url: string): boolean {
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return false;
  }
  if (alvo.protocol !== 'https:') return false;
  const host = alvo.hostname.replace(/^\[|\]$/g, '');
  if (!host || NOMES_INTERNOS.test(host)) return false;
  return isIP(host) ? !ipPrivado(host) : true;
}

export type Resolvedor = (host: string) => Promise<string[]>;

const resolverDns: Resolvedor = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

const MENSAGEM = 'O Endereço da API precisa ser público e usar https://.';

/** Antes de cada chamada: o nome também precisa resolver só para IPs públicos. */
export async function verificarDestino(url: string, resolver: Resolvedor = resolverDns): Promise<void> {
  if (!enderecoPublicoHttps(url)) throw new RecusadoPelaPlataforma(MENSAGEM);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return;
  let ips: string[];
  try {
    ips = await resolver(host);
  } catch {
    throw new PlataformaIndisponivel();
  }
  if (!ips.length || ips.some(ipPrivado)) throw new RecusadoPelaPlataforma(MENSAGEM);
}
