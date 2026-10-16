// Catálogo sem preço: a API já manda os valores zerados; aqui só decidimos o que aparece na tela.
// Definido uma vez na abertura do link (o mesmo link nunca muda de modo).

let visiveis = true;

export const precos = {
  visiveis: () => visiveis,
  definir(v: boolean) {
    visiveis = v;
  },
};
