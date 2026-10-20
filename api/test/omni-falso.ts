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
  /**
   * Como o proxy da Kentro devolve respostas de erro da API:
   * - rejeita: rejeita com http_error, status e body (padrão);
   * - resolve: resolve com {status, body} mesmo em erro (como a SisAgenda trata);
   * - kentro: como o toError do host: 401/403 → forbidden, 404 → not_found, 429 → rate_limited, demais → http_error só com status.
   */
  proxy?: 'rejeita' | 'resolve' | 'kentro';
  /** Atendimento aberto (omni.chats.getSelected); padrão: nenhum. */
  chat?: { id: number | string; contactId?: number; contact?: { name?: string; phone?: string } } | null;
  /** Contatos por id (omni.contacts.get). */
  contatos?: Record<string, { name?: string; phone?: string }>;
  /** Intervalo da consulta periódica do painel, para o teste não esperar 5 s. */
  intervaloMs?: number;
  /** Carrinho nativo do atendimento (omni.cart). Ausente = SDK sem carrinho. */
  carrinho?: { disponivel?: boolean; linhas?: { productId: number; qty: number }[]; recusar?: Record<number, string> };
  /** Catálogo da Kentro (omni.products.list). Ausente = SDK sem products. */
  produtos?: Record<string, unknown>[];
  /** API REST da instância (omni.data.request) por recurso; recurso sem resposta é recusado (bad_args). */
  dados?: Record<string, unknown>;
  /** Resposta do omni.ui.confirm (padrão: confirma). */
  confirmar?: boolean;
}

export interface Tela {
  document: Document;
  chamadas: ChamadaHttp[];
  storage: Record<string, unknown>;
  /** Mesmo objeto das respostas simuladas: o teste pode trocar entre uma consulta e outra. */
  respostas: Record<string, { status: number; body: unknown }>;
  toasts: string[];
  copiados: string[];
  /** Operações no carrinho nativo: ["add", produto, qtd] ou ["set", produto, qtd]. */
  operacoesCarrinho: [string, number, number][];
  clicar(id: string): Promise<void>;
  texto(id: string): string;
  visivel(id: string): boolean;
  preencher(id: string, valor: string): void;
  valor(id: string): string;
  /** Dispara um evento do host (ex.: omniChatSelected). */
  emitir(evento: string, dado: unknown): Promise<void>;
  esperar(ms?: number): Promise<void>;
  /** Simula a aba da Kentro ficando oculta/visível. */
  ocultar(oculto: boolean): Promise<void>;
  fechar(): void;
}

const DIR = path.join(__dirname, '..', '..', 'extension');

async function esperar(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function montarTela(arquivo: string, opcoes: OpcoesTela): Promise<Tela> {
  const chamadas: ChamadaHttp[] = [];
  const storage: Record<string, unknown> = { ...(opcoes.storage ?? {}) };
  const respostas = opcoes.respostas ?? {};
  const ouvintes: Record<string, ((dado: unknown) => void)[]> = {};
  const toasts: string[] = [];
  const copiados: string[] = [];
  const operacoesCarrinho: [string, number, number][] = [];
  const linhas = (opcoes.carrinho?.linhas ?? []).map((l) => ({ ...l }));
  const recusar = opcoes.carrinho?.recusar ?? {};
  const estadoCarrinho = () => ({ available: opcoes.carrinho?.disponivel !== false, lines: linhas.map((l) => ({ ...l })), totals: {} });
  const operar = (tipo: string, id: number, qtd: number) => {
    operacoesCarrinho.push([tipo, id, qtd]);
    if (recusar[id]) return Promise.resolve({ ok: true, rejected: [{ reason: recusar[id], op: { productId: id, qty: qtd } }], cart: estadoCarrinho() });
    const linha = linhas.find((l) => l.productId === id);
    if (linha) linha.qty = tipo === 'add' ? linha.qty + qtd : qtd;
    else linhas.push({ productId: id, qty: qtd });
    return Promise.resolve({ ok: true, rejected: [], cart: estadoCarrinho() });
  };

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
    on(evento: string, cb: (dado: unknown) => void) {
      (ouvintes[evento] ??= []).push(cb);
    },
    chats: { getSelected: () => Promise.resolve(opcoes.chat ?? null) },
    ...(opcoes.produtos ? { products: { list: () => Promise.resolve(opcoes.produtos!.map((p) => ({ ...p }))) } } : {}),
    data: {
      request: (recurso: string) =>
        opcoes.dados && recurso in opcoes.dados ? Promise.resolve(opcoes.dados[recurso]) : Promise.reject({ code: 'bad_args', message: 'recurso desconhecido' }),
    },
    contacts: { get: (id: number) => Promise.resolve(opcoes.contatos?.[String(id)] ?? null) },
    ...(opcoes.carrinho
      ? {
          cart: {
            get: () => Promise.resolve(estadoCarrinho()),
            add: (id: number, o: { qty?: number } = {}) => operar('add', id, o.qty ?? 1),
            setQuantity: (id: number, qtd: number) => operar('set', id, qtd),
          },
        }
      : {}),
    http: {
      request(req: ChamadaHttp) {
        chamadas.push(req);
        const caminho = new URL(req.url).pathname;
        const resposta = respostas[`${req.method} ${caminho}`];
        if (!resposta) return Promise.reject({ code: 'timeout', message: 'sem resposta simulada' });
        const body = JSON.stringify(resposta.body);
        const ok = resposta.status >= 200 && resposta.status < 300;
        if (ok || opcoes.proxy === 'resolve') return Promise.resolve({ status: resposta.status, headers: {}, body });
        if (opcoes.proxy === 'kentro') {
          if (resposta.status === 401 || resposta.status === 403) return Promise.reject({ code: 'forbidden', message: 'Operação não permitida' });
          if (resposta.status === 404) return Promise.reject({ code: 'not_found', message: 'Recurso não encontrado' });
          if (resposta.status === 429) return Promise.reject({ code: 'rate_limited', message: 'Limite' });
          return Promise.reject({ code: 'http_error', status: resposta.status, message: '' });
        }
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
    ui: {
      toast: (texto: string) => {
        toasts.push(texto);
        return Promise.resolve();
      },
      resize: () => Promise.resolve(),
      confirm: () => Promise.resolve({ confirmed: opcoes.confirmar !== false }),
    },
  };

  let oculto = false;
  const html = readFileSync(path.join(DIR, arquivo), 'utf8');
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    beforeParse(window) {
      (window as unknown as { omni: typeof omni }).omni = omni;
      if (opcoes.intervaloMs) (window as unknown as { KENTRO_SHOP_INTERVALO_MS: number }).KENTRO_SHOP_INTERVALO_MS = opcoes.intervaloMs;
      // O jsdom não abre abas: dentro da Kentro a nova aba também pode ser bloqueada (a tela tem o link de reserva).
      window.open = () => null;
      // O jsdom considera a página sempre oculta; aqui ela começa visível e o teste controla.
      Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => oculto });
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (texto: string) => {
            copiados.push(texto);
            return Promise.resolve();
          },
        },
      });
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
    respostas,
    toasts,
    copiados,
    operacoesCarrinho,
    async emitir(evento, dado) {
      for (const cb of ouvintes[evento] ?? []) cb(dado);
      await esperar();
    },
    async esperar(ms = 0) {
      await new Promise((r) => setTimeout(r, ms));
      await esperar();
    },
    async ocultar(valor) {
      oculto = valor;
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
      await esperar();
    },
    fechar: () => dom.window.close(),
    async clicar(id) {
      elemento(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await esperar();
    },
    texto: (id) => elemento(id).textContent?.trim() ?? '',
    preencher(id, valor) {
      (elemento(id) as HTMLInputElement).value = valor;
    },
    valor: (id) => (elemento(id) as HTMLInputElement).value,
    visivel(id) {
      for (let el: HTMLElement | null = elemento(id); el; el = el.parentElement) if (el.hidden) return false;
      return true;
    },
  };
}
