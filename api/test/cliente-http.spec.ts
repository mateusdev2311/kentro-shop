import { ChamadaRegistrada, criarClienteHttp } from '../src/conectores/nucleo/cliente-http';
import { CredencialInvalida, LimiteDaPlataforma, PlataformaIndisponivel, RecusadoPelaPlataforma } from '../src/conectores/nucleo/erros';
import { BaldeDeFichas } from '../src/conectores/nucleo/ritmo';

type Resposta = { status: number; corpo?: unknown; cabecalhos?: Record<string, string> };

let seq = 0;

function montar(respostas: Array<Resposta | 'pendurar'>, timeoutMs = 8000) {
  const registros: ChamadaRegistrada[] = [];
  const esperas: number[] = [];
  const urls: string[] = [];
  let i = 0;
  const fetchFalso = ((url: string, init: RequestInit) => {
    urls.push(url);
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r === 'pendurar') {
      return new Promise((_, rejeitar) => init.signal?.addEventListener('abort', () => rejeitar(new Error('abortado'))));
    }
    return Promise.resolve(
      new Response(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo ?? {}), { status: r.status, headers: r.cabecalhos }),
    );
  }) as unknown as typeof fetch;
  seq += 1;
  const cliente = criarClienteHttp({
    lojaId: `loja-${seq}`,
    plataforma: 'teste',
    ritmo: { porSegundo: 1000, rajada: 1000 },
    fetch: fetchFalso,
    timeoutMs,
    registrar: async (c) => {
      registros.push(c);
    },
    esperar: async (ms) => {
      esperas.push(ms);
    },
  });
  const pedir = () =>
    cliente.requisitar({ metodo: 'GET', url: 'https://loja.test/api/product/all?search=piso&token=x', operacao: 'listarProdutos', cabecalhos: { Authorization: 'segredo' } });
  return { pedir, registros, esperas, urls };
}

describe('ClienteHttpConector', () => {
  it('devolve o JSON e registra a chamada pela operação', async () => {
    const { pedir, registros } = montar([{ status: 200, corpo: { success: true, data: [1] } }]);
    expect(await pedir()).toEqual({ status: 200, corpo: { success: true, data: [1] } });
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ plataforma: 'teste', operacao: 'listarProdutos', statusHttp: 200, erroCodigo: null });
  });

  it('o registro nunca guarda URL, query nem credencial', async () => {
    const { pedir, registros } = montar([{ status: 200 }]);
    await pedir();
    const texto = JSON.stringify(registros);
    expect(texto).not.toContain('?');
    expect(texto).not.toContain('loja.test');
    expect(texto).not.toContain('segredo');
  });

  it('tenta de novo em 5xx com espera exponencial', async () => {
    const { pedir, esperas, registros } = montar([{ status: 500 }, { status: 500 }, { status: 200, corpo: { ok: 1 } }]);
    expect((await pedir()).corpo).toEqual({ ok: 1 });
    expect(esperas).toEqual([500, 1000]);
    expect(registros.map((r) => r.statusHttp)).toEqual([500, 500, 200]);
  });

  it('respeita o Retry-After do 429', async () => {
    const { pedir, esperas } = montar([{ status: 429, cabecalhos: { 'Retry-After': '3' } }, { status: 200 }]);
    await pedir();
    expect(esperas).toEqual([3000]);
  });

  it('desiste depois de 2 novas tentativas', async () => {
    const indisponivel = montar([{ status: 503 }]);
    await expect(indisponivel.pedir()).rejects.toBeInstanceOf(PlataformaIndisponivel);
    expect(indisponivel.registros).toHaveLength(3);
    const limite = montar([{ status: 429 }]);
    await expect(limite.pedir()).rejects.toBeInstanceOf(LimiteDaPlataforma);
  });

  it('credencial recusada não é repetida', async () => {
    const { pedir, registros } = montar([{ status: 401 }]);
    await expect(pedir()).rejects.toBeInstanceOf(CredencialInvalida);
    expect(registros).toHaveLength(1);
  });

  it('outros 4xx trazem a mensagem da plataforma', async () => {
    const { pedir } = montar([{ status: 400, corpo: { success: false, errors: ['SKU inválido'] } }]);
    await expect(pedir()).rejects.toEqual(new RecusadoPelaPlataforma('SKU inválido'));
  });

  it('plataforma que não responde estoura o timeout e vira indisponível', async () => {
    const { pedir, registros } = montar(['pendurar'], 30);
    await expect(pedir()).rejects.toBeInstanceOf(PlataformaIndisponivel);
    expect(registros).toHaveLength(3);
    expect(registros[0]).toMatchObject({ statusHttp: null, erroCodigo: 'TIMEOUT' });
  });

  it('erro com corpo que não é JSON não devolve o texto bruto', async () => {
    const { pedir } = montar([{ status: 400, corpo: '<html>painel interno: senha=123</html>' }]);
    await expect(pedir()).rejects.toEqual(new RecusadoPelaPlataforma(''));
  });

  it('confere o destino antes de chamar e não chama se for proibido', async () => {
    const urls: string[] = [];
    const cliente = criarClienteHttp({
      lojaId: 'destino-1',
      plataforma: 'teste',
      ritmo: { porSegundo: 1000, rajada: 1000 },
      fetch: ((url: string) => {
        urls.push(url);
        return Promise.resolve(new Response('{}'));
      }) as unknown as typeof fetch,
      registrar: async () => undefined,
      verificarDestino: async () => {
        throw new RecusadoPelaPlataforma('Endereço não permitido.');
      },
    });
    await expect(cliente.requisitar({ metodo: 'GET', url: 'https://169.254.169.254/x', operacao: 'x' })).rejects.toEqual(
      new RecusadoPelaPlataforma('Endereço não permitido.'),
    );
    expect(urls).toEqual([]);
  });

  it('corpo que não é JSON volta como texto', async () => {
    const { pedir } = montar([{ status: 200, corpo: 'ok, texto' }]);
    expect((await pedir()).corpo).toBe('ok, texto');
  });
});

describe('BaldeDeFichas', () => {
  it('libera a rajada na hora e depois espera no ritmo', async () => {
    let agora = 1_000_000;
    const esperas: number[] = [];
    const balde = new BaldeDeFichas(2, 5, () => agora, async (ms) => {
      esperas.push(ms);
      agora += ms;
    });
    for (let i = 0; i < 5; i++) await balde.aguardar();
    expect(esperas).toEqual([]);
    await balde.aguardar();
    expect(esperas).toEqual([500]);
  });

  it('chamadas simultâneas saem uma por vez no ritmo, sem rajada atrasada', async () => {
    const saidas: number[] = [];
    const balde = new BaldeDeFichas(2, 5, () => 1_000_000, async (ms) => {
      await Promise.resolve();
      saidas.push(ms);
    });
    await Promise.all(Array.from({ length: 10 }, () => balde.aguardar()));
    // 5 imediatas; as outras 5 esperam 0,5 s, 1 s, 1,5 s, 2 s e 2,5 s (uma ficha a cada 500 ms).
    expect(saidas.sort((a, b) => a - b)).toEqual([500, 1000, 1500, 2000, 2500]);
  });

  it('espera longa demais vira LimiteDaPlataforma em vez de pendurar a chamada', async () => {
    const balde = new BaldeDeFichas(1, 1, () => 0, async () => undefined, 2000);
    await balde.aguardar();
    await balde.aguardar(); // espera 1 s
    await balde.aguardar(); // espera 2 s
    await expect(balde.aguardar()).rejects.toBeInstanceOf(LimiteDaPlataforma); // precisaria de 3 s
  });
});
