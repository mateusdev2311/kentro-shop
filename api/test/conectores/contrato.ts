import { criarClienteHttp } from '../../src/conectores/nucleo/cliente-http';
import { CatalogoLocal, Conector, CtxConector } from '../../src/conectores/nucleo/conector';
import { CredencialInvalida } from '../../src/conectores/nucleo/erros';
import { Produto } from '../../src/contratos/modelo';

// Bateria de contrato (spec 7.3): roda contra CADA conector. Nenhum conector entra sem passar.

export interface CenarioContrato {
  conector: Conector;
  credenciaisValidas: Record<string, string>;
  /** Ausente = conector sem credenciais (ex.: catálogo da Kentro, que lê a cópia sincronizada). */
  credenciaisInvalidas?: Record<string, string>;
  /** fetch que responde com as respostas gravadas. Ausente = conector que não usa HTTP. */
  fetchDeFixtures?: typeof fetch;
  /** Cópia do catálogo, para o conector que não lê a plataforma ao vivo. */
  catalogoLocal?: () => CatalogoLocal;
  idSimples: string;
  idComVariacao: string;
  idInexistente: string;
  buscaVazia: string;
  porPagina: number;
}

let seq = 0;

function contexto(c: CenarioContrato, credenciais: Record<string, string>, fetchUsado?: typeof fetch): CtxConector {
  seq += 1;
  return {
    lojaId: `contrato-${seq}`,
    credenciais,
    http: criarClienteHttp({
      lojaId: `contrato-${seq}`,
      plataforma: c.conector.id,
      ritmo: { porSegundo: 1000, rajada: 1000 },
      fetch: fetchUsado ?? c.fetchDeFixtures,
      esperar: async () => undefined,
      registrar: async () => undefined,
    }),
    salvarCredenciais: async () => undefined,
    ...(c.catalogoLocal ? { catalogoLocal: c.catalogoLocal() } : {}),
  };
}

function conferirProduto(p: Produto): void {
  expect(typeof p.id).toBe('string');
  expect(p.id).not.toBe('');
  expect(typeof p.sku).toBe('string');
  expect(typeof p.nome).toBe('string');
  expect(typeof p.preco).toBe('number');
  expect(Number.isFinite(p.preco)).toBe(true);
  expect(p.preco).toBeGreaterThan(0);
  if (p.precoDe !== undefined) expect(p.precoDe).toBeGreaterThan(p.preco);
  expect(p.estoque === null || typeof p.estoque === 'number').toBe(true);
  expect(typeof p.disponivel).toBe('boolean');
  expect(typeof p.unidade).toBe('string');
  expect(p.unidade).not.toBe('');
  expect(p.descricao).not.toMatch(/<\/?[a-z][^>]*>/i); // sem tags HTML (o texto pode ter "> 0,4")
  for (const url of p.imagens) expect(url).toMatch(/^https:\/\//);
  for (const id of p.categoriaIds) expect(typeof id).toBe('string');
  for (const v of p.variacoes) {
    expect(typeof v.id).toBe('string');
    expect(typeof v.preco).toBe('number');
    expect(v.preco).toBeGreaterThan(0);
    expect(typeof v.disponivel).toBe('boolean');
  }
}

export function rodarContrato(nome: string, montar: () => CenarioContrato): void {
  describe(`contrato do conector: ${nome}`, () => {
    const c = montar();
    const ctx = () => contexto(c, c.credenciaisValidas);

    it('declara capacidades coerentes com os métodos', () => {
      const { conector } = c;
      const { capacidades } = conector;
      expect(typeof conector.relacionados === 'function').toBe(capacidades.relacionados);
      expect(typeof conector.cotarFrete === 'function').toBe(capacidades.cotarFrete);
      expect(typeof conector.criarPedido === 'function').toBe(capacidades.criarPedido);
      expect(typeof conector.urlDeAutorizacao === 'function').toBe(capacidades.oauth);
      expect(typeof conector.historicoDoCliente === 'function').toBe(capacidades.historicoCliente);
      // Conector com credencial declara os campos; o sem credencial não declara nenhum.
      expect(conector.camposDeCredencial.length > 0).toBe(!!c.credenciaisInvalidas);
    });

    it('lista categorias normalizadas', async () => {
      const categorias = await c.conector.listarCategorias(ctx());
      expect(categorias.length).toBeGreaterThan(0);
      for (const cat of categorias) {
        expect(typeof cat.id).toBe('string');
        expect(typeof cat.nome).toBe('string');
      }
    });

    it('lista produtos normalizados e pagina', async () => {
      const p1 = await c.conector.listarProdutos(ctx(), { pagina: 1, porPagina: c.porPagina });
      expect(p1.itens.length).toBeGreaterThan(0);
      p1.itens.forEach(conferirProduto);
      expect(p1.temMais).toBe(true);
      const p2 = await c.conector.listarProdutos(ctx(), { pagina: 2, porPagina: c.porPagina });
      p2.itens.forEach(conferirProduto);
      expect(p2.temMais).toBe(false);
      expect(p2.pagina).toBe(2);
    });

    it('busca sem resultado devolve lista vazia', async () => {
      const r = await c.conector.listarProdutos(ctx(), { busca: c.buscaVazia, pagina: 1, porPagina: c.porPagina });
      expect(r.itens).toEqual([]);
      expect(r.temMais).toBe(false);
    });

    it('obtém produto simples e produto com variação', async () => {
      const simples = await c.conector.obterProduto(ctx(), c.idSimples);
      expect(simples).not.toBeNull();
      conferirProduto(simples!);
      expect(simples!.variacoes).toEqual([]);
      // Plataforma sem variações (ex.: catálogo da Kentro) não precisa ter produto com variação.
      if (!c.conector.capacidades.variacoes) return;
      const comVariacao = await c.conector.obterProduto(ctx(), c.idComVariacao);
      conferirProduto(comVariacao!);
      expect(comVariacao!.variacoes.length).toBeGreaterThan(0);
    });

    it('produto inexistente devolve null', async () => {
      expect(await c.conector.obterProduto(ctx(), c.idInexistente)).toBeNull();
    });

    if (c.credenciaisInvalidas) {
      const invalidas = c.credenciaisInvalidas;
      it('credencial inválida vira CredencialInvalida', async () => {
        await expect(c.conector.listarProdutos(contexto(c, invalidas), { pagina: 1, porPagina: c.porPagina })).rejects.toBeInstanceOf(CredencialInvalida);
      });
    }

    if (c.fetchDeFixtures) {
      it('limite da plataforma (429) é repetido e depois atendido', async () => {
        let primeira = true;
        const comLimite = ((url: string, init: RequestInit) => {
          if (primeira) {
            primeira = false;
            return Promise.resolve(new Response('{}', { status: 429 }));
          }
          return c.fetchDeFixtures!(url, init);
        }) as typeof fetch;
        const r = await c.conector.listarProdutos(contexto(c, c.credenciaisValidas, comLimite), { pagina: 1, porPagina: c.porPagina });
        expect(r.itens.length).toBeGreaterThan(0);
      });
    }
  });
}
