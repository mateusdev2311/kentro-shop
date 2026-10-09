import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';

// Simula o SDK `omni` que a Kentro injeta no iframe, para testar as telas das extensões.

export interface ChamadaHttp {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface OpcoesTela {
  config: Record<string, string>;
  /** Respostas por "MÉTODO caminho", ex.: "GET /v1/loja". */
  respostas?: Record<string, { status: number; body: unknown }>;
  storage?: Record<string, unknown>;
  usuario?: { id: number; name: string; type: number };
}

export interface Tela {
  document: Document;
  chamadas: ChamadaHttp[];
  storage: Record<string, unknown>;
  clicar(id: string): Promise<void>;
  texto(id: string): string;
  visivel(id: string): boolean;
}

const DIR = path.join(__dirname, '..', '..', 'extension');

async function esperar(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function montarTela(arquivo: string, opcoes: OpcoesTela): Promise<Tela> {
  const chamadas: ChamadaHttp[] = [];
  const storage: Record<string, unknown> = { ...(opcoes.storage ?? {}) };
  const respostas = opcoes.respostas ?? {};

  const omni = {
    ready(cb: (ctx: unknown) => void) {
      setTimeout(
        () =>
          cb({
            config: opcoes.config,
            user: opcoes.usuario ?? { id: 7, name: 'Ana', type: 0 },
            instance: { name: 'Kentro Teste', domain: 'loja.kentro.test' },
          }),
        0,
      );
    },
    on() {},
    http: {
      request(req: ChamadaHttp) {
        chamadas.push(req);
        const caminho = new URL(req.url).pathname;
        const resposta = respostas[`${req.method} ${caminho}`];
        if (!resposta) return Promise.reject({ code: 'timeout', message: 'sem resposta simulada' });
        const body = JSON.stringify(resposta.body);
        if (resposta.status >= 200 && resposta.status < 300) return Promise.resolve({ status: resposta.status, headers: {}, body });
        return Promise.reject({ code: 'http_error', status: resposta.status, body });
      },
    },
    storage: {
      get: (k: string) => Promise.resolve(k in storage ? storage[k] : null),
      set: (k: string, v: unknown) => {
        storage[k] = v;
        return Promise.resolve({ key: k, value: v });
      },
      remove: (k: string) => {
        delete storage[k];
        return Promise.resolve({ key: k, removed: true });
      },
    },
    ui: { toast: () => Promise.resolve(), resize: () => Promise.resolve() },
  };

  const html = readFileSync(path.join(DIR, arquivo), 'utf8');
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    beforeParse(window) {
      (window as unknown as { omni: typeof omni }).omni = omni;
    },
  });
  await esperar();

  const document = dom.window.document;
  const elemento = (id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`elemento #${id} não existe`);
    return el;
  };
  return {
    document,
    chamadas,
    storage,
    async clicar(id) {
      elemento(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await esperar();
    },
    texto: (id) => elemento(id).textContent?.trim() ?? '',
    visivel(id) {
      for (let el: HTMLElement | null = elemento(id); el; el = el.parentElement) if (el.hidden) return false;
      return true;
    },
  };
}
