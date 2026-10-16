import { LimiteDaPlataforma } from './erros';

export const dormir = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Token bucket: até `rajada` chamadas seguidas e depois `porSegundo` por segundo.
 * A ficha é reservada ANTES de esperar, então chamadas simultâneas saem uma por vez no ritmo.
 * Se a espera passar de `maxEsperaMs`, a chamada é recusada em vez de ficar pendurada.
 */
export class BaldeDeFichas {
  private fichas: number;
  private ultimo: number;

  constructor(
    private readonly porSegundo: number,
    private readonly rajada: number,
    private readonly agora: () => number = Date.now,
    private readonly esperar: (ms: number) => Promise<void> = dormir,
    private readonly maxEsperaMs = 10_000,
  ) {
    this.fichas = rajada;
    this.ultimo = agora();
  }

  async aguardar(): Promise<void> {
    this.reabastecer();
    this.fichas -= 1;
    if (this.fichas >= 0) return;
    const espera = Math.ceil((-this.fichas / this.porSegundo) * 1000);
    if (espera > this.maxEsperaMs) {
      this.fichas += 1;
      throw new LimiteDaPlataforma();
    }
    await this.esperar(espera);
  }

  private reabastecer(): void {
    const agora = this.agora();
    this.fichas = Math.min(this.rajada, this.fichas + ((agora - this.ultimo) / 1000) * this.porSegundo);
    this.ultimo = agora;
  }
}
