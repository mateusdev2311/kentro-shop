import { categoriasDaView, conectorAutomatiza, idCategoria, produtoDaView, titulo } from '../../src/conectores/automatiza/automatiza.conector';
import { ClienteBanco } from '../../src/conectores/nucleo/banco';
import { CatalogoLocal, CtxConector } from '../../src/conectores/nucleo/conector';
import { CredencialInvalida, PlataformaIndisponivel, RecusadoPelaPlataforma } from '../../src/conectores/nucleo/erros';
import { bancoEmMemoria, BancoMemoria, CREDENCIAIS_BANCO, LINHAS_VIEW } from './banco-memoria';
import { copiaEmMemoria } from './catalogo-memoria';

const ctx = (banco?: ClienteBanco, catalogoLocal?: CatalogoLocal): CtxConector => ({
  lojaId: 'aut',
  credenciais: CREDENCIAIS_BANCO,
  http: { requisitar: () => Promise.reject(new Error('o conector do Automatiza não faz HTTP')) },
  salvarCredenciais: async () => undefined,
  ...(banco ? { banco } : {}),
  ...(catalogoLocal ? { catalogoLocal } : {}),
});

describe('conector ERP Automatiza (views do MySQL)', () => {
  it('normaliza a linha da view: preço de delivery, preço de tabela maior vira "de", EAN na busca', () => {
    expect(produtoDaView(LINHAS_VIEW[0])).toEqual({
      produto: {
        id: '101',
        sku: '101',
        nome: 'SABONETE NEUTRO 90G',
        descricao: 'Laboratório: LABORATORIO TESTE LTDA',
        imagens: [],
        preco: 3.99,
        precoDe: 4.99,
        unidade: 'UN',
        estoque: 5,
        disponivel: true,
        categoriaIds: [idCategoria('HIGIENE E BELEZA')],
        variacoes: [],
      },
      termos: '7890000000101',
      codigoBarras: '7890000000101',
    });
    expect(produtoDaView(LINHAS_VIEW[1])!.produto.precoDe).toBeUndefined(); // mesmo preço: sem "de"
  });

  it('deixa de fora controlado, fora de linha, sem estoque, sem preço e uso interno (grupo ou subgrupo)', () => {
    const fora = LINHAS_VIEW.filter((l) => Number(l.codigo_mercadoria) >= 200);
    expect(fora.map(produtoDaView)).toEqual(fora.map(() => null));
    expect(produtoDaView({ ...LINHAS_VIEW[0], tipo_controle: 'Psicotropico' })).toBeNull(); // mesmo sem a marca de controle
    expect(produtoDaView({ ...LINHAS_VIEW[0], codigo_mercadoria: 'abc' })).toBeNull();
  });

  it('o mesmo subgrupo em grupos diferentes vira uma categoria, com nome legível', () => {
    expect(idCategoria('DERMOCOSMETICOS')).toBe(idCategoria(' dermocosméticos  '));
    expect(titulo('HIGIENE E BELEZA')).toBe('Higiene e Beleza');
    expect(titulo('GENERICO_OTC')).toBe('Generico OTC');
    const usadas = new Set([idCategoria('DERMOCOSMETICOS'), idCategoria('GENERICO_OTC')]);
    expect(categoriasDaView(LINHAS_VIEW, usadas)).toEqual([
      { id: idCategoria('DERMOCOSMETICOS'), nome: 'Dermocosmeticos' },
      { id: idCategoria('GENERICO_OTC'), nome: 'Generico OTC' },
    ]);
  });

  it('lê o catálogo inteiro numa consulta, com o filtro por parâmetro e tempo maior', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    const catalogo = await conectorAutomatiza.lerCatalogoCompleto!(ctx(banco));
    expect(catalogo.produtos.map((p) => p.produto.id)).toEqual(['101', '102', '103', '104', '105']);
    expect(catalogo.categorias.map((c) => c.nome)).toEqual(['Dermocosmeticos', 'Generico OTC', 'Higiene e Beleza']);
    expect(banco.consultas).toEqual([{ operacao: 'sincronizar_catalogo', sql: expect.stringContaining('FROM view_ecommerce_delivery_produtos'), parametros: ['ATIVO'] }]);
  });

  it('teste de conexão: confere a filial no banco e pede a sincronização até ela acontecer', async () => {
    const banco = bancoEmMemoria(CREDENCIAIS_BANCO);
    expect(await conectorAutomatiza.testarConexao(ctx(banco, copiaEmMemoria([], [], null)))).toEqual({
      ok: false,
      mensagem: 'Banco conectado (FARMACIA TESTE - LOJA07), mas os produtos ainda não foram sincronizados. Clique em "Sincronizar agora".',
    });
    const produtos = LINHAS_VIEW.slice(0, 2).map((l) => produtoDaView(l)!);
    expect(await conectorAutomatiza.testarConexao(ctx(banco, copiaEmMemoria(produtos, [])))).toEqual({ ok: true, nomeLoja: 'FARMACIA TESTE - LOJA07 (2 produtos)' });
    expect((await conectorAutomatiza.testarConexao(ctx(bancoEmMemoria(CREDENCIAIS_BANCO, { filial: null }), copiaEmMemoria(produtos, [])))).ok).toBe(false);
  });

  it('teste de conexão leva os erros do banco: senha errada e banco fora do ar', async () => {
    const copia = copiaEmMemoria([], []);
    await expect(conectorAutomatiza.testarConexao(ctx(bancoEmMemoria({ ...CREDENCIAIS_BANCO, senha: 'x' }), copia))).rejects.toBeInstanceOf(CredencialInvalida);
    await expect(conectorAutomatiza.testarConexao(ctx(bancoEmMemoria(CREDENCIAIS_BANCO, { fora: true }), copia))).rejects.toBeInstanceOf(PlataformaIndisponivel);
  });

  it('busca pelo código de barras e lê o produto pela cópia, sem ir ao banco', async () => {
    const banco: BancoMemoria = bancoEmMemoria(CREDENCIAIS_BANCO);
    const produtos = LINHAS_VIEW.map(produtoDaView).filter((p) => !!p).map((p) => p!);
    const c = ctx(banco, copiaEmMemoria(produtos, []));
    expect((await conectorAutomatiza.listarProdutos(c, { busca: '7890000000104', pagina: 1, porPagina: 10 })).itens.map((p) => p.nome)).toEqual(['PROTETOR SOLAR FPS50 120ML']);
    expect((await conectorAutomatiza.obterProduto(c, '103'))!.nome).toBe('DIPIRONA 500MG 10 COMPRIMIDOS');
    expect(banco.consultas).toEqual([]);
  });

  it('valida as credenciais ao salvar: endereço público, porta e nome do banco', () => {
    expect(conectorAutomatiza.validarCredenciais!(CREDENCIAIS_BANCO)).toBeNull();
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, host: '192.168.0.10' })).toMatch(/endereço público/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, host: 'localhost' })).toMatch(/endereço público/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, host: 'http://banco.teste' })).toMatch(/sem http/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, porta: '70000' })).toMatch(/porta/);
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, banco: 'x; drop' })).toMatch(/nome do banco/);
    // Trocar o servidor ou a porta exige digitar a senha de novo.
    // Um destino por senha: a do banco vai ao servidor do banco; a do FTP, ao FTP.
    expect(conectorAutomatiza.destino!(CREDENCIAIS_BANCO)).toEqual({ senha: 'banco.erp.teste:3306', ftp_senha: '' });
    expect(conectorAutomatiza.destino!({ ...CREDENCIAIS_BANCO, porta: '', ftp_host: 'arquivos.teste', ftp_porta: '6785' })).toEqual({
      senha: 'banco.erp.teste:3306',
      ftp_senha: 'arquivos.teste:6785',
    });
    // FTP opcional, mas se vier precisa estar completo.
    expect(conectorAutomatiza.validarCredenciais!({ ...CREDENCIAIS_BANCO, ftp_host: 'arquivos.teste' })).toMatch(/usuário e a senha do FTP/);
  });

  it('sem o banco ou a cópia no contexto, recusa em vez de quebrar', async () => {
    await expect(conectorAutomatiza.lerCatalogoCompleto!(ctx())).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
    await expect(conectorAutomatiza.listarCategorias(ctx())).rejects.toBeInstanceOf(RecusadoPelaPlataforma);
  });
});
