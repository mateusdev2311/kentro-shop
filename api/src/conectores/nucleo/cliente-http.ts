import { ClienteHttpConector, RequisicaoConector, RespostaConector } from './conector';
import { CredencialInvalida, LimiteDaPlataforma, NaoEncontrado, PlataformaIndisponivel, RecusadoPelaPlataforma } from './erros';
import { BaldeDeFichas, dormir } from './ritmo';

export interface ChamadaRegistrada {
  lojaId: string;
  plataforma: string;
  operacao: string;
  statusHttp: number | null;
  ms: number;
  erroCodigo: string | null;
}

export interface OpcoesClienteHttp {
  lojaId: string;
  plataforma: string;
  ritmo: { porSegundo: number; rajada: number };
  registrar: (chamada: ChamadaRegistrada) => Promise<void>;
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Recusa destinos proibidos (ex.: rede privada) antes de chamar. */
  verificarDestino?: (url: string) => Promise<void>;
}

const ESPERAS = [500, 1000];
const MAX_NOVAS_TENTATIVAS = ESPERAS.length;
const MAX_RETRY_AFTER_MS = 10_000;

// Um balde por loja + plataforma: o ritmo de uma loja não consome o de outra.
const baldes = new Map<string, BaldeDeFichas>();

function balde(opcoes: OpcoesClienteHttp): BaldeDeFichas {
  const chave = `${opcoes.lojaId}|${opcoes.plataforma}`;
  let b = baldes.get(chave);
  if (!b) {
    b = new BaldeDeFichas(opcoes.ritmo.porSegundo, opcoes.ritmo.rajada, Date.now, opcoes.esperar ?? dormir);
    baldes.set(chave, b);
  }
  return b;
}

function mensagemDoCorpo(corpo: unknown): string {
  // Texto que não é JSON (página de erro, painel interno) nunca volta para quem chamou.
  if (typeof corpo === 'string') return '';
  const c = corpo as { errors?: unknown; message?: unknown; mensagem?: unknown } | null;
  if (Array.isArray(c?.errors) && c.errors.length) return String(c.errors[0]);
  if (c?.errors && typeof c.errors === 'object') {
    const primeiro = Object.values(c.errors as Record<string, unknown>)[0];
    if (primeiro) return String(primeiro);
  }
  return String(c?.message ?? c?.mensagem ?? '');
}

function lerCorpo(texto: string): unknown {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return texto;
  }
}

/** Cliente HTTP comum a todos os conectores (spec 7.2). Nenhum conector usa fetch direto. */
export function criarClienteHttp(opcoes: OpcoesClienteHttp): ClienteHttpConector {
  const fazerFetch = opcoes.fetch ?? fetch;
  const esperar = opcoes.esperar ?? dormir;
  const timeoutMs = opcoes.timeoutMs ?? 8000;

  const registrar = (operacao: string, statusHttp: number | null, inicio: number, erroCodigo: string | null) =>
    opcoes
      .registrar({ lojaId: opcoes.lojaId, plataforma: opcoes.plataforma, operacao, statusHttp, ms: Date.now() - inicio, erroCodigo })
      .catch(() => undefined); // o registro nunca derruba a chamada

  return {
    async requisitar(req: RequisicaoConector): Promise<RespostaConector> {
      await opcoes.verificarDestino?.(req.url);
      for (let tentativa = 0; ; tentativa++) {
        await balde(opcoes).aguardar();
        const inicio = Date.now();
        const controle = new AbortController();
        const relogio = setTimeout(() => controle.abort(), timeoutMs);
        let status: number;
        let corpo: unknown;
        let retryAfter: string | null = null;
        try {
          const resposta = await fazerFetch(req.url, {
            method: req.metodo,
            headers: { Accept: 'application/json', ...(req.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...req.cabecalhos },
            body: req.corpo !== undefined ? JSON.stringify(req.corpo) : undefined,
            signal: controle.signal,
          });
          status = resposta.status;
          retryAfter = resposta.headers.get('retry-after');
          corpo = lerCorpo(await resposta.text());
        } catch {
          const erroCodigo = controle.signal.aborted ? 'TIMEOUT' : 'REDE';
          await registrar(req.operacao, null, inicio, erroCodigo);
          if (tentativa < MAX_NOVAS_TENTATIVAS) {
            await esperar(ESPERAS[tentativa]);
            continue;
          }
          throw new PlataformaIndisponivel();
        } finally {
          clearTimeout(relogio);
        }

        if (status >= 200 && status < 300) {
          await registrar(req.operacao, status, inicio, null);
          return { status, corpo };
        }

        const repetir = status === 429 || status >= 500;
        await registrar(req.operacao, status, inicio, repetir ? (status === 429 ? 'LIMITE' : 'INDISPONIVEL') : `HTTP_${status}`);
        if (status === 401 || status === 403) throw new CredencialInvalida();
        if (status === 404) throw new NaoEncontrado();
        if (!repetir) throw new RecusadoPelaPlataforma(mensagemDoCorpo(corpo));
        if (tentativa >= MAX_NOVAS_TENTATIVAS) throw status === 429 ? new LimiteDaPlataforma() : new PlataformaIndisponivel();

        const segundos = Number(retryAfter);
        await esperar(retryAfter && Number.isFinite(segundos) ? Math.min(segundos * 1000, MAX_RETRY_AFTER_MS) : ESPERAS[tentativa]);
      }
    },
  };
}
