import { Injectable } from '@nestjs/common';

const MAX_ITENS = 5000;

/**
 * Cache curto das leituras do catálogo, por loja (só para conectores com cacheSegundos).
 * Guarda a promessa: chamadas simultâneas do mesmo produto viram uma só. Erro nunca fica guardado.
 * Os webhooks da plataforma (produto alterado ou apagado) limpam a loja inteira.
 */
@Injectable()
export class CacheCatalogo {
  private readonly itens = new Map<string, { expira: number; valor: Promise<unknown> }>();

  obter<T>(lojaId: string, chave: string, segundos: number | undefined, carregar: () => Promise<T>): Promise<T> {
    if (!segundos) return carregar();
    const k = `${lojaId}|${chave}`;
    const agora = Date.now();
    const atual = this.itens.get(k);
    if (atual && atual.expira > agora) return atual.valor as Promise<T>;
    const valor = carregar();
    this.guardarPromessa(k, valor, agora + segundos * 1000);
    return valor;
  }

  /** O que já se tem nas mãos (ex.: produtos que vieram juntos numa consulta). */
  guardar<T>(lojaId: string, chave: string, segundos: number | undefined, valor: T): void {
    if (segundos) this.guardarPromessa(`${lojaId}|${chave}`, Promise.resolve(valor), Date.now() + segundos * 1000);
  }

  /** Ainda válido? undefined = não está em cache. */
  existe(lojaId: string, chave: string): boolean {
    const atual = this.itens.get(`${lojaId}|${chave}`);
    return !!atual && atual.expira > Date.now();
  }

  invalidar(lojaId: string): void {
    const prefixo = `${lojaId}|`;
    for (const k of this.itens.keys()) if (k.startsWith(prefixo)) this.itens.delete(k);
  }

  private guardarPromessa(k: string, valor: Promise<unknown>, expira: number): void {
    this.itens.set(k, { expira, valor });
    valor.catch(() => {
      if (this.itens.get(k)?.valor === valor) this.itens.delete(k);
    });
    if (this.itens.size > MAX_ITENS) {
      const agora = Date.now();
      for (const [chave, item] of this.itens) if (item.expira <= agora) this.itens.delete(chave);
      // Ainda cheio: sai o mais antigo (o Map guarda a ordem de inserção).
      while (this.itens.size > MAX_ITENS) this.itens.delete(this.itens.keys().next().value!);
    }
  }
}
