import { CatalogoLocal, CtxConector } from '../../src/conectores/nucleo/conector';
import { RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { conectorKentro, produtoDoSdk } from '../../src/conectores/kentro/kentro.conector';
import { catalogoEmMemoria, PRODUTOS_SDK } from './catalogo-memoria';

const ctx = (catalogoLocal?: CatalogoLocal): CtxConector => ({
  lojaId: 'ktr',
  credenciais: {},
  http: { requisitar: () => Promise.reject(new Error('o conector da Kentro não faz HTTP')) },
  salvarCredenciais: async () => undefined,
  ...(catalogoLocal ? { catalogoLocal } : {}),
});

describe('conector Kentro (cópia sincronizada pela extensão)', () => {
  it('não pede nada na integração: nem endereço nem token', () => {
    expect(conectorKentro.camposDeCredencial).toEqual([]);
  });

  it('normaliza o produto do SDK: preço na unidade da moeda, descrição sem HTML, foto em https', () => {
    expect(produtoDoSdk(PRODUTOS_SDK[0])).toEqual({
      id: '1',
      sku: 'PRC-1',
      nome: 'Porcelanato Bege',
      descricao: 'Caixa com 1,44 m²',
      imagens: ['https://cdn.kentro.teste/p1.jpg'],
      preco: 119.9,
      unidade: 'CX',
      estoque: null,
      disponivel: true,
      categoriaIds: ['1'],
      variacoes: [],
    });
    const tinta = produtoDoSdk(PRODUTOS_SDK[1])!;
    expect(tinta.sku).toBe('2'); // sem código interno, o SKU é o id
    expect(tinta.unidade).toBe('UN');
    expect(tinta.imagens).toEqual(['https://inseguro.teste/t.jpg']); // http vira https, como nos outros conectores
    expect(produtoDoSdk(PRODUTOS_SDK[2])!.disponivel).toBe(false);
  });

  it('descarta o oculto para clientes e o que não tem id numérico ou nome', () => {
    expect(produtoDoSdk(PRODUTOS_SDK[4])).toBeNull();
    expect(produtoDoSdk({ id: 'abc', name: 'X', price: 1 })).toBeNull();
    expect(produtoDoSdk({ id: 7, name: '  ', price: 1 })).toBeNull();
  });

  it('sem preço continua no catálogo com preço 0 (o catálogo sem preço vira lista de orçamento)', () => {
    expect(produtoDoSdk({ id: 8, name: 'Sob consulta', available: true })).toMatchObject({ preco: 0, disponivel: true });
  });

  it('teste de conexão: pede a primeira sincronização e avisa catálogo vazio', async () => {
    expect(await conectorKentro.testarConexao(ctx(catalogoEmMemoria([], [], null)))).toEqual({
      ok: false,
      mensagem: 'O catálogo da Kentro ainda não foi sincronizado. Clique em "Sincronizar agora".',
    });
    expect((await conectorKentro.testarConexao(ctx(catalogoEmMemoria([], [])))).ok).toBe(false);
    expect(await conectorKentro.testarConexao(ctx(catalogoEmMemoria()))).toEqual({ ok: true, nomeLoja: 'Catálogo da Kentro (4 produtos)' });
  });

  it('busca sem acento, filtra por grupo e acha o produto pelo id ou pelo SKU', async () => {
    const c = ctx(catalogoEmMemoria());
    expect((await conectorKentro.listarProdutos(c, { busca: 'acrilica', pagina: 1, porPagina: 10 })).itens.map((p) => p.nome)).toEqual(['Tinta Acrílica']);
    expect((await conectorKentro.listarProdutos(c, { categoriaId: '1', pagina: 1, porPagina: 10 })).itens.map((p) => p.id)).toEqual(['6', '1', '5']);
    expect((await conectorKentro.obterProduto(c, 'ARG'))!.id).toBe('6');
    expect(await conectorKentro.obterProduto(c, '4')).toBeNull(); // oculto não entrou na cópia
  });

  it('sem a cópia no contexto, recusa em vez de quebrar', async () => {
    await expect(conectorKentro.listarCategorias(ctx())).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
  });
});
