import { paraBusca } from '../../src/catalogo-kentro/catalogo-kentro.service';
import { produtoDoSdk } from '../../src/conectores/kentro/kentro.conector';
import { CatalogoLocal } from '../../src/conectores/nucleo/conector';
import { Categoria, Produto } from '../../src/contratos/modelo';

// Cópia do catálogo em memória, com a mesma regra de busca e paginação da cópia no banco.

/** Produtos como o SDK da extensão entrega (omni.products.list); dados sintéticos. */
export const PRODUTOS_SDK = [
  { id: 1, name: 'Porcelanato Bege', description: '<p>Caixa com <b>1,44 m²</b></p>', internalCode: 'PRC-1', price: 119.9, value: 119.9, measurementUnit: 'cx', groupIds: [1], available: true, hiddenFromClients: false, imageUrl: 'https://cdn.kentro.teste/p1.jpg' },
  { id: 2, name: 'Tinta Acrílica', internalCode: '', price: 80, measurementUnit: '', groupIds: [2], available: true, hiddenFromClients: false, imageUrl: 'http://inseguro.teste/t.jpg' },
  { id: 5, name: 'Rejunte Cinza', price: 50, groupIds: [1], available: false, hiddenFromClients: false },
  { id: 6, name: 'Argamassa AC3', internalCode: 'ARG', price: 39.9, groupIds: [1], available: true, hiddenFromClients: false },
  { id: 4, name: 'Produto Oculto', price: 10, groupIds: [1], available: true, hiddenFromClients: true },
];

export const GRUPOS_SDK: Categoria[] = [
  { id: '1', nome: 'Pisos' },
  { id: '2', nome: 'Tintas' },
];

export function catalogoEmMemoria(
  brutos: Record<string, unknown>[] = PRODUTOS_SDK,
  grupos: Categoria[] = GRUPOS_SDK,
  sincronizadoEm: Date | null = new Date('2026-10-19T12:00:00Z'),
): CatalogoLocal {
  const produtos = brutos
    .map(produtoDoSdk)
    .filter((p): p is Produto => !!p)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return {
    estado: async () => ({ sincronizadoEm, total: produtos.length }),
    categorias: async () => grupos,
    async produtos(filtro) {
      const termo = paraBusca(filtro.busca?.trim() ?? '');
      const achados = produtos.filter(
        (p) => (!termo || paraBusca(`${p.nome} ${p.sku}`).includes(termo)) && (!filtro.categoriaId || p.categoriaIds.includes(filtro.categoriaId)),
      );
      const pular = (filtro.pagina - 1) * filtro.porPagina;
      const itens = achados.slice(pular, pular + filtro.porPagina);
      return { itens, pagina: filtro.pagina, porPagina: filtro.porPagina, total: achados.length, temMais: pular + itens.length < achados.length };
    },
    produto: async (id) => produtos.find((p) => p.id === id) ?? produtos.find((p) => p.sku === id) ?? null,
  };
}
