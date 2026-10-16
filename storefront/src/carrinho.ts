import type { Api } from './api';
import { ehErroDaApi } from './api';
import { pedidoAberto, type PedidoDeItem, type Sessao } from './tipos';

/**
 * Estado do carrinho no navegador. A tela muda na hora (otimista) e o servidor recebe o carrinho
 * inteiro 350 ms depois da última mudança; a resposta do servidor é a verdade (preço, estoque).
 * Toda mudança local ou recarga sobe a versão, e resposta de versão antiga é descartada — assim
 * duas abas ou cliques rápidos não fazem o carrinho "voltar".
 */
export interface EventosCarrinho {
  aoMudar(): void;
  aoAviso(texto: string, erro?: boolean): void;
}

export interface DocumentoVisivel {
  readonly hidden: boolean;
  addEventListener(tipo: 'visibilitychange', f: () => void): void;
  removeEventListener(tipo: 'visibilitychange', f: () => void): void;
}

export const ATRASO_SINCRONIA = 350;
const MAX = 999;

const chave = (produtoId: string, variacaoId?: string | null) => `${produtoId}|${variacaoId ?? ''}`;

export type Carrinho = ReturnType<typeof criarCarrinho>;

export function criarCarrinho(
  api: Pick<Api, 'salvarCarrinho' | 'abrir'>,
  eventos: EventosCarrinho,
  documento: DocumentoVisivel | null = typeof document === 'undefined' ? null : document,
) {
  let sessao: Sessao | null = null;
  let local = new Map<string, PedidoDeItem>();
  let versao = 0;
  let pendente = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let emVoo: Promise<boolean> | null = null;

  function aplicar(nova: Sessao): void {
    sessao = nova;
    local = new Map(nova.itens.map((i) => [chave(i.produtoId, i.variacaoId), { produtoId: i.produtoId, variacaoId: i.variacaoId ?? undefined, quantidade: i.quantidade }]));
    eventos.aoMudar();
  }

  /**
   * Envia já o que está pendente (ou espera o envio em voo). true = o servidor tem o carrinho da tela.
   * A finalização depende disso para não fechar um carrinho velho.
   */
  async function sincronizarJa(): Promise<boolean> {
    clearTimeout(timer);
    if (!pendente) return emVoo ?? true;
    pendente = false;
    const envio = enviar();
    emVoo = envio;
    try {
      return await envio;
    } finally {
      if (emVoo === envio) emVoo = null;
    }
  }

  async function enviar(): Promise<boolean> {
    const minha = ++versao;
    try {
      const r = await api.salvarCarrinho([...local.values()]);
      if (minha !== versao) return true;
      aplicar(r.sessao);
      for (const aviso of r.avisos) eventos.aoAviso(aviso, true);
      return true;
    } catch (e) {
      if (minha !== versao) return true;
      eventos.aoAviso(ehErroDaApi(e) ? e.mensagem : 'Não foi possível salvar o carrinho.', true);
      // Pedido já enviado (ex.: finalizado em outra aba): traz o estado do servidor.
      if (ehErroDaApi(e) && e.codigo === 'PEDIDO_JA_ENVIADO') await recarregar();
      return false;
    }
  }

  async function recarregar(): Promise<void> {
    const minha = ++versao;
    try {
      const r = await api.abrir();
      if (minha === versao && !pendente) aplicar(r.sessao);
    } catch {
      // Mantém o que está na tela.
    }
  }

  function alterar(produtoId: string, variacaoId: string | null | undefined, quantidade: number): void {
    if (!pedidoAberto(sessao)) {
      eventos.aoAviso('Seu pedido já foi enviado ao atendente.', true);
      return;
    }
    const k = chave(produtoId, variacaoId);
    const q = Math.max(0, Math.min(MAX, Math.floor(quantidade) || 0));
    if (q > 0) local.set(k, { produtoId, ...(variacaoId ? { variacaoId } : {}), quantidade: q });
    else local.delete(k);
    pendente = true;
    versao += 1; // invalida respostas ainda em voo
    eventos.aoMudar();
    clearTimeout(timer);
    timer = setTimeout(() => void sincronizarJa(), ATRASO_SINCRONIA);
  }

  // Saindo da aba com alteração não enviada: envia já (o navegador pode congelar a aba).
  // Voltando sem pendência: recarrega do servidor (o cliente pode ter mexido em outro aparelho).
  const aoVisibilidade = () => {
    if (!sessao || !pedidoAberto(sessao)) return;
    if (documento?.hidden) {
      if (pendente) void sincronizarJa();
    } else if (!pendente) {
      void recarregar();
    }
  };
  documento?.addEventListener('visibilitychange', aoVisibilidade);

  return {
    get sessao() {
      return sessao;
    },
    get pendente() {
      return pendente;
    },
    get totalItens() {
      let total = 0;
      for (const i of local.values()) total += i.quantidade;
      return total;
    },
    quantidade: (produtoId: string, variacaoId?: string | null) => local.get(chave(produtoId, variacaoId))?.quantidade ?? 0,
    quantidadeDoProduto(produtoId: string): number {
      let total = 0;
      for (const i of local.values()) if (i.produtoId === produtoId) total += i.quantidade;
      return total;
    },
    alterar,
    somar(produtoId: string, variacaoId: string | null | undefined, delta: number) {
      alterar(produtoId, variacaoId, this.quantidade(produtoId, variacaoId) + delta);
    },
    aplicar,
    sincronizarJa,
    recarregar,
    destruir() {
      clearTimeout(timer);
      documento?.removeEventListener('visibilitychange', aoVisibilidade);
    },
  };
}
