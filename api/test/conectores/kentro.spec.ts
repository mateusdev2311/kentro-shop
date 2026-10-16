import { criarClienteHttp } from '../../src/conectores/nucleo/cliente-http';
import { CtxConector } from '../../src/conectores/nucleo/conector';
import { CredencialInvalida, RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { conectorKentro, enderecoMcp } from '../../src/conectores/kentro/kentro.conector';
import { ChamadaMcp, criarFetchKentro, KENTRO_CREDENCIAIS, OpcoesMcpFalso } from './fixtures-kentro';

let seq = 0;

function ctx(opcoes: OpcoesMcpFalso = {}, credenciais: Record<string, string> = KENTRO_CREDENCIAIS): CtxConector {
  seq += 1;
  return {
    lojaId: `ktr-${seq}`,
    credenciais,
    http: criarClienteHttp({
      lojaId: `ktr-${seq}`,
      plataforma: 'kentro',
      ritmo: { porSegundo: 1000, rajada: 1000 },
      fetch: criarFetchKentro(opcoes),
      esperar: async () => undefined,
      registrar: async () => undefined,
    }),
    salvarCredenciais: async () => undefined,
  };
}

describe('conector Kentro (catálogo interno pelo MCP da instância)', () => {
  it('campos: endereço da Kentro (url) e token do MCP (segredo)', () => {
    expect(conectorKentro.camposDeCredencial.map((c) => [c.chave, c.tipo, c.obrigatorio])).toEqual([
      ['url_kentro', 'url', true],
      ['token_mcp', 'segredo', true],
    ]);
  });

  it('endereço do MCP: aceita o domínio da Kentro ou o /mcp completo', () => {
    expect(enderecoMcp('https://kentro.teste')).toBe('https://kentro.teste/mcp');
    expect(enderecoMcp('https://kentro.teste/')).toBe('https://kentro.teste/mcp');
    expect(enderecoMcp('https://kentro.teste:443/mcp')).toBe('https://kentro.teste/mcp');
    expect(() => enderecoMcp('http://kentro.teste')).toThrow(RecusadoPelaPlataforma);
  });

  it('abre a sessão uma vez (initialize + initialized) e reaproveita nas chamadas seguintes', async () => {
    const chamadas: ChamadaMcp[] = [];
    const c = ctx({ chamadas });
    await conectorKentro.listarCategorias(c);
    await conectorKentro.obterProduto(c, '1');
    expect(chamadas.map((x) => x.metodo)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
    expect(chamadas[0].autorizacao).toBe('Bearer mcp-certo');
    expect(chamadas[2].sessao).toMatch(/^sessao-\d+$/);
    expect(chamadas[3].sessao).toBe(chamadas[2].sessao);
  });

  it('sessão expirada no servidor: abre outra e repete a chamada', async () => {
    const chamadas: ChamadaMcp[] = [];
    const expirar = { agora: false };
    const c = ctx({ chamadas, expirar });
    await conectorKentro.listarCategorias(c);
    expirar.agora = true;
    const cats = await conectorKentro.listarCategorias(c);
    expect(cats).toHaveLength(2);
    expect(chamadas.filter((x) => x.metodo === 'initialize')).toHaveLength(2);
  });

  it('entende resposta em SSE (text/event-stream)', async () => {
    const p = await conectorKentro.obterProduto(ctx({ sse: true }), '6');
    expect(p).toMatchObject({ id: '6', nome: 'Argamassa AC3', preco: 39.9 });
  });

  it('normaliza o produto: centavos, promoção, unidade, foto, grupo e texto puro', async () => {
    const p = await conectorKentro.obterProduto(ctx(), '1');
    expect(p).toEqual({
      id: '1',
      sku: 'PRC-1',
      nome: 'Porcelanato Bege',
      descricao: 'Caixa com 1,44 m²',
      imagens: ['https://cdn.kentro.teste/p1.jpg'],
      preco: 99.9,
      precoDe: 119.9,
      unidade: 'CX',
      estoque: 10,
      disponivel: true,
      categoriaIds: ['1'],
      variacoes: [],
    });
    const tinta = await conectorKentro.obterProduto(ctx(), '2');
    expect(tinta).toMatchObject({ sku: '2', preco: 80, estoque: null, categoriaIds: ['2'], imagens: ['https://cdn.kentro.teste/t.jpg'] });
    expect(tinta!.precoDe).toBeUndefined();
    expect((await conectorKentro.obterProduto(ctx(), '5'))!.disponivel).toBe(false);
  });

  it('arquivado, oculto para clientes e inexistente não existem para o cliente', async () => {
    expect(await conectorKentro.obterProduto(ctx(), '3')).toBeNull();
    expect(await conectorKentro.obterProduto(ctx(), '4')).toBeNull();
    expect(await conectorKentro.obterProduto(ctx(), '999')).toBeNull();
  });

  it('acha pelo código interno (SKU)', async () => {
    expect((await conectorKentro.obterProduto(ctx(), 'ARG'))!.id).toBe('6');
    expect(await conectorKentro.obterProduto(ctx(), 'NAO-EXISTE')).toBeNull();
  });

  it('lista com busca e por grupo (categoria), sem arquivados e ocultos', async () => {
    const chamadas: ChamadaMcp[] = [];
    const pisos = await conectorKentro.listarProdutos(ctx({ chamadas }), { categoriaId: '1', pagina: 1, porPagina: 24 });
    expect(pisos.itens.map((p) => p.id)).toEqual(['1', '5', '6']);
    expect(chamadas.find((c) => c.ferramenta === 'products_list')!.argumentos).toEqual({ limit: 24, offset: 0, groupId: 1 });
    const busca = await conectorKentro.listarProdutos(ctx(), { busca: 'tinta', pagina: 1, porPagina: 24 });
    expect(busca.itens.map((p) => p.id)).toEqual(['2']);
    const todos = await conectorKentro.listarProdutos(ctx(), { pagina: 1, porPagina: 24 });
    expect(todos.itens.map((p) => p.id)).toEqual(['1', '2', '5', '6']);
  });

  it('token recusado vira CredencialInvalida; teste de conexão funciona com o token certo', async () => {
    await expect(conectorKentro.listarCategorias(ctx({}, { ...KENTRO_CREDENCIAIS, token_mcp: 'errado' }))).rejects.toBeInstanceOf(CredencialInvalida);
    expect(await conectorKentro.testarConexao(ctx())).toEqual({ ok: true });
  });
});
