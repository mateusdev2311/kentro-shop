import { Inject, Injectable } from '@nestjs/common';
import { Conector } from './conector';
import { NaoEncontrado } from './erros';

export const CONECTORES = Symbol('CONECTORES');

/** Adicionar uma plataforma = criar a pasta do conector e incluí-lo na lista de CONECTORES. */
@Injectable()
export class RegistroConectores {
  constructor(@Inject(CONECTORES) private readonly conectores: Conector[]) {}

  listar(): Conector[] {
    return this.conectores;
  }

  obter(id: string): Conector {
    const conector = this.conectores.find((c) => c.id === id);
    if (!conector) throw new NaoEncontrado('Plataforma de e-commerce não suportada.');
    return conector;
  }
}
