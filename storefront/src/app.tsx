import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Api } from './api';
import { ehErroDaApi } from './api';
import { criarCarrinho, type DocumentoVisivel } from './carrinho';
import type { EnderecoCep } from './cep';
import { brl, iniciais, primeiroNome } from './formato';
import { precos } from './precos';
import { pedidoAberto, type Abertura, type Categoria, type CorpoFinalizar, type Diferenca, type Produto } from './tipos';
import { Carrinho, linhasDoCarrinho, subtotalDaTela } from './telas/Carrinho';
import { Checkout } from './telas/Checkout';
import { Confirmado } from './telas/Confirmado';
import { Detalhe } from './telas/Detalhe';
import { Diferencas } from './telas/Diferencas';
import { LinkInvalido } from './telas/LinkInvalido';
import { CompreTambem, Vitrine } from './telas/Vitrine';

export interface Dependencias {
  api: Api;
  buscarCep: (cep: string) => Promise<EnderecoCep | null>;
  documento?: DocumentoVisivel | null;
}

const ATRASO_BUSCA = 400;
const DURACAO_AVISO = 2600;
const COR_VALIDA = /^#[0-9a-f]{3,8}$/i;

type Painel = null | 'carrinho' | 'checkout' | 'diferencas';

export function App({ api, buscarCep, documento }: Dependencias) {
  const [, setVersaoTela] = useState(0);
  const redesenhar = () => setVersaoTela((n) => n + 1);
  const [abertura, setAbertura] = useState<Abertura | null>(null);
  const [erroAbertura, setErroAbertura] = useState<{ mensagem: string; podeTentar: boolean } | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const timerAviso = useRef<ReturnType<typeof setTimeout>>();

  const mostrarAviso = useCallback((texto: string, erro = false) => {
    setAviso({ texto, erro });
    clearTimeout(timerAviso.current);
    timerAviso.current = setTimeout(() => setAviso(null), DURACAO_AVISO);
  }, []);

  const carrinho = useMemo(
    () => criarCarrinho(api, { aoMudar: redesenhar, aoAviso: mostrarAviso }, documento === undefined ? document : documento),
    [],
  );
  useEffect(() => () => carrinho.destruir(), []);

  // ── Abertura do link ─────────────────────────────────
  const [painel, setPainel] = useState<Painel>(null);
  /** Link montado pelo atendente: a vitrine começa no filtro dele ("Separados para você"). */
  const [selecao, setSelecao] = useState(false);
  const abrir = useCallback(async () => {
    setErroAbertura(null);
    try {
      const a = await api.abrir();
      precos.definir(a.mostrarPrecos !== false);
      carrinho.aplicar(a.sessao);
      setSelecao(!!a.filtro);
      setAbertura(a);
      if (!pedidoAberto(a.sessao)) setPainel('carrinho');
      api
        .categorias()
        .then(setCategorias)
        .catch(() => setCategorias([]));
    } catch (e) {
      if (ehErroDaApi(e) && e.status === 404) setErroAbertura({ mensagem: e.mensagem, podeTentar: false });
      else setErroAbertura({ mensagem: 'Não conseguimos carregar o catálogo. Verifique sua conexão e tente de novo.', podeTentar: true });
    }
  }, []);
  useEffect(() => void abrir(), []);

  useEffect(() => {
    if (!abertura) return;
    if (COR_VALIDA.test(abertura.tema.corPrimaria)) document.documentElement.style.setProperty('--cor-primaria', abertura.tema.corPrimaria);
    if (abertura.tema.corTopo && COR_VALIDA.test(abertura.tema.corTopo)) document.documentElement.style.setProperty('--cor-topo', abertura.tema.corTopo);
    document.title = abertura.tema.nome;
  }, [abertura]);

  // ── Busca, categoria e páginas ───────────────────────
  const [buscaDigitada, setBuscaDigitada] = useState('');
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [pagina, setPagina] = useState(1);
  const [temMais, setTemMais] = useState(false);
  const [total, setTotal] = useState<number | undefined>();
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState('');
  const pedidoLista = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setBusca(buscaDigitada.trim()), ATRASO_BUSCA);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  const carregar = useCallback(
    async (numero: number) => {
      const meu = ++pedidoLista.current;
      setCarregando(true);
      setErroLista('');
      try {
        const r = await api.produtos({ busca, categoria: selecao ? undefined : categoria, pagina: numero, selecao });
        if (meu !== pedidoLista.current) return;
        setProdutos((atuais) => {
          if (numero === 1) return r.itens;
          const vistos = new Set(atuais.map((p) => p.id));
          return [...atuais, ...r.itens.filter((p) => !vistos.has(p.id))];
        });
        setPagina(r.pagina);
        setTemMais(r.temMais);
        setTotal(r.total);
      } catch (e) {
        if (meu === pedidoLista.current) setErroLista(ehErroDaApi(e) ? e.mensagem : 'Não foi possível carregar os produtos.');
      } finally {
        if (meu === pedidoLista.current) setCarregando(false);
      }
    },
    [busca, categoria, selecao],
  );

  useEffect(() => {
    if (!abertura) return;
    setProdutos([]);
    void carregar(1);
  }, [abertura, carregar]);

  const carregarMais = () => {
    if (!carregando && temMais) void carregar(pagina + 1);
  };

  // ── Compre também (fim da vitrine do link) ───────────
  const [sugestoes, setSugestoes] = useState<Produto[] | null>(null);
  const noFimDaSelecao = !!abertura?.filtro && selecao && !temMais && !carregando;
  useEffect(() => {
    if (!noFimDaSelecao || sugestoes !== null) return;
    api
      .sugestoes()
      .then(setSugestoes)
      .catch(() => setSugestoes([]));
  }, [noFimDaSelecao, sugestoes]);

  function verTodos() {
    setSelecao(false);
    setCategoria('');
    setBuscaDigitada('');
    window.scrollTo?.(0, 0);
  }

  // ── Painéis ──────────────────────────────────────────
  const [detalhe, setDetalhe] = useState<Produto | null>(null);
  const [diferencas, setDiferencas] = useState<{ lista: Diferenca[]; corpo: CorpoFinalizar } | null>(null);
  const finalizado = !pedidoAberto(carrinho.sessao);

  useEffect(() => {
    document.body.classList.toggle('travado', !!detalhe || !!painel);
  }, [detalhe, painel]);

  useEffect(() => {
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (detalhe) setDetalhe(null);
      else if (painel) setPainel(null);
    };
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [detalhe, painel]);

  function abrirCarrinho() {
    setDetalhe(null);
    setPainel('carrinho');
    void carrinho.sincronizarJa(); // itens recém-adicionados aparecem com os dados do servidor
  }

  async function finalizar(corpo: CorpoFinalizar): Promise<void> {
    // O servidor precisa ter o carrinho da tela antes de fechar o pedido.
    if (!(await carrinho.sincronizarJa())) throw { status: 0, codigo: 'CARRINHO', mensagem: 'Não foi possível salvar o carrinho. Tente de novo.' };
    try {
      const sessao = await api.finalizar(corpo);
      carrinho.aplicar(sessao);
      setDiferencas(null);
      setPainel('carrinho');
      window.scrollTo?.(0, 0);
    } catch (e) {
      if (ehErroDaApi(e) && e.codigo === 'PRECOS_ALTERADOS') {
        if (e.sessao) carrinho.aplicar(e.sessao);
        setDiferencas({ lista: e.diferencas ?? [], corpo });
        setPainel('diferencas');
        return;
      }
      if (ehErroDaApi(e) && e.codigo === 'PEDIDO_JA_ENVIADO') void carrinho.recarregar();
      throw e;
    }
  }

  // ── Telas ────────────────────────────────────────────
  if (erroAbertura) return <LinkInvalido mensagem={erroAbertura.mensagem} aoTentarDeNovo={erroAbertura.podeTentar ? () => void abrir() : undefined} />;
  if (!abertura || !carrinho.sessao) return <p class="carregando">Carregando…</p>;

  const sessao = carrinho.sessao;
  const nome = primeiroNome(sessao.cliente.nome);
  const ultimoPedido = abertura.historico?.pedidos[0];
  const filtroLink = abertura.filtro;
  const emSelecao = selecao && !!filtroLink;
  const nomeCategoria = filtroLink?.categoriaId ? categorias.find((c) => c.id === filtroLink.categoriaId)?.nome : undefined;
  const tituloDaSelecao = filtroLink?.produtoIds?.length
    ? 'Separados para você'
    : nomeCategoria
      ? `Selecionados para você: ${nomeCategoria}`
      : filtroLink?.busca
        ? `Selecionados para você: "${filtroLink.busca}"`
        : 'Selecionados para você';

  function escolherCategoria(id: string) {
    setSelecao(false);
    setCategoria(id);
  }

  // Os itens entram como qualquer outro: o servidor revalida preço e estoque (e avisa o que não existe mais).
  function pedirDeNovo() {
    if (!ultimoPedido) return;
    for (const i of ultimoPedido.itens) carrinho.alterar(i.produtoId, i.variacaoId, carrinho.quantidade(i.produtoId, i.variacaoId) + i.quantidade);
    mostrarAviso('Itens do último pedido adicionados ao carrinho');
  }
  const totalItens = carrinho.totalItens;
  const catAtual = categorias.find((c) => c.id === categoria);
  const quantos = total ?? produtos.length;

  let conteudoPainel = null;
  if (painel) {
    if (finalizado) conteudoPainel = <Confirmado sessao={sessao} />;
    else if (painel === 'diferencas' && diferencas)
      conteudoPainel = <Diferencas diferencas={diferencas.lista} aoConfirmar={() => finalizar(diferencas.corpo)} aoVoltar={() => setPainel('carrinho')} />;
    else if (painel === 'checkout' && linhasDoCarrinho(carrinho).length)
      conteudoPainel = (
        <Checkout
          abertura={abertura}
          sessao={sessao}
          subtotal={subtotalDaTela(carrinho)}
          api={api}
          buscarCep={buscarCep}
          aoEnviar={finalizar}
          aoVoltar={() => setPainel('carrinho')}
        />
      );
    else conteudoPainel = <Carrinho carrinho={carrinho} aoContinuar={() => setPainel('checkout')} aoFechar={() => setPainel(null)} />;
  }

  return (
    <>
      <header class="marca-faixa">
        <div class="marca">
          {abertura.tema.logoUrl ? (
            <span class="marca-logo">
              <img class="marca-icone" src={abertura.tema.logoUrl} alt="" />
            </span>
          ) : (
            <span class="marca-icone" aria-hidden="true">
              {iniciais(abertura.tema.nome).slice(0, 1)}
            </span>
          )}
          <div>
            <strong>{abertura.tema.nome}</strong>
            <small>{finalizado ? 'Pedido enviado ao atendente' : nome ? `Olá, ${nome}! Catálogo exclusivo` : 'Catálogo exclusivo'}</small>
          </div>
        </div>
      </header>
      <div class="topo">
        <div class="topo-conteudo">
          <div class="busca">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <input
              type="search"
              placeholder="Buscar produtos…"
              aria-label="Buscar produtos"
              autocomplete="off"
              enterKeyHint="search"
              value={buscaDigitada}
              onInput={(e) => setBuscaDigitada(e.currentTarget.value)}
            />
          </div>
          <button type="button" class="botao-carrinho" aria-label={`Abrir carrinho (${totalItens} ${totalItens === 1 ? 'item' : 'itens'})`} onClick={abrirCarrinho}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M2.5 3.5h2.3l2.5 11a1 1 0 0 0 1 .8h9a1 1 0 0 0 1-.8l1.6-7.3H6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx="9.5" cy="19.5" r="1.6" fill="currentColor" />
              <circle cx="17" cy="19.5" r="1.6" fill="currentColor" />
            </svg>
            {totalItens > 0 && <span class="contador">{totalItens}</span>}
          </button>
        </div>
        {categorias.length > 0 && (
          <nav class="categorias" aria-label="Categorias">
            <button type="button" class={categoria === '' && !emSelecao ? 'ativa' : ''} onClick={() => escolherCategoria('')}>
              Todos
            </button>
            {categorias.map((c) => (
              <button type="button" key={c.id} class={categoria === c.id && !emSelecao ? 'ativa' : ''} onClick={() => escolherCategoria(c.id)}>
                {c.nome}
              </button>
            ))}
          </nav>
        )}
      </div>

      <main>
        {emSelecao && (
          <section class="selecao">
            <strong>{tituloDaSelecao}</strong>
            <button type="button" class="botao-texto" onClick={verTodos}>
              Ver todo o catálogo
            </button>
          </section>
        )}
        {!busca && !categoria && !emSelecao && abertura.tema.destaque !== false && (
          <section class="destaque">
            <div>
              <p class="destaque-rotulo">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 19.5 5.2 16A8 8 0 1 1 8 18.8L4 19.5Z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  />
                </svg>
                Atendimento pelo WhatsApp
              </p>
              <h1>
                Monte seu pedido <em>com calma.</em>
              </h1>
              <p class="destaque-texto">
                {abertura.tema.boasVindas || 'Escolha os produtos, ajuste as quantidades e finalize. Um atendente confirma tudo com você na conversa.'}
              </p>
            </div>
            <ol class="passos">
              <li>
                <span>1</span>
                <p>
                  <strong>Escolha</strong> os produtos e as quantidades
                </p>
              </li>
              <li>
                <span>2</span>
                <p>
                  <strong>Envie</strong> {precos.visiveis() ? 'o pedido' : 'o pedido de orçamento'} por aqui mesmo
                </p>
              </li>
              <li>
                <span>3</span>
                <p>
                  <strong>Confirme</strong> os detalhes com o atendente na conversa
                </p>
              </li>
            </ol>
          </section>
        )}
        {!busca && !categoria && !finalizado && ultimoPedido && (
          <section class="pedir-de-novo">
            <div>
              <strong>Seu último pedido</strong>
              <small>{new Date(ultimoPedido.data).toLocaleDateString('pt-BR')}</small>
            </div>
            <ul>
              {ultimoPedido.itens.slice(0, 4).map((i) => (
                <li key={`${i.produtoId}|${i.variacaoId ?? ''}`}>
                  {i.quantidade}× {i.nome}
                  {i.variacaoNome ? ` (${i.variacaoNome})` : ''}
                </li>
              ))}
              {ultimoPedido.itens.length > 4 && <li>e mais {ultimoPedido.itens.length - 4}</li>}
            </ul>
            <button type="button" class="botao" onClick={pedirDeNovo}>
              Pedir de novo
            </button>
          </section>
        )}
        {produtos.length > 0 && (
          <div class="resultado">
            {!emSelecao && <h2>{busca ? `“${busca}”` : (catAtual?.nome ?? 'Todos os produtos')}</h2>}
            <span>
              {quantos} produto{quantos === 1 ? '' : 's'}
              {busca && catAtual && !emSelecao ? ` em ${catAtual.nome}` : ''}
            </span>
          </div>
        )}
        <Vitrine
          produtos={produtos}
          noCarrinho={carrinho.quantidadeDoProduto}
          aoAbrir={setDetalhe}
          temMais={temMais}
          carregando={carregando}
          erro={erroLista}
          aoCarregarMais={carregarMais}
          layout={abertura.tema.layout ?? 'grade'}
        />
        {emSelecao && noFimDaSelecao && sugestoes !== null && (
          <CompreTambem
            produtos={sugestoes}
            noCarrinho={carrinho.quantidadeDoProduto}
            aoAbrir={setDetalhe}
            aoVerTodos={verTodos}
            layout={abertura.tema.layout ?? 'grade'}
          />
        )}
      </main>

      {totalItens > 0 && !finalizado && !painel && !detalhe && (
        <div class="barra-carrinho">
          <div class="barra-resumo">
            <small>
              {totalItens} {totalItens === 1 ? 'item' : 'itens'} no carrinho
            </small>
            {precos.visiveis() && <strong>{brl(subtotalDaTela(carrinho))}</strong>}
          </div>
          <button type="button" class="botao primario" onClick={abrirCarrinho}>
            Ver carrinho
          </button>
        </div>
      )}

      {detalhe && (
        <div class="painel">
          <div class="painel-fundo" onClick={() => setDetalhe(null)} />
          <section class="painel-folha" role="dialog" aria-modal="true" aria-labelledby="produto-nome">
            <button type="button" class="fechar" aria-label="Fechar" onClick={() => setDetalhe(null)}>
              ×
            </button>
            <Detalhe key={detalhe.id} produto={detalhe} api={api} carrinho={carrinho} aviso={mostrarAviso} />
          </section>
        </div>
      )}

      {painel && (
        <div class="painel">
          <div class="painel-fundo" onClick={() => setPainel(null)} />
          <section class="painel-folha lateral" role="dialog" aria-modal="true" aria-labelledby="carrinho-titulo">
            <button type="button" class="fechar" aria-label="Fechar" onClick={() => setPainel(null)}>
              ×
            </button>
            {conteudoPainel}
          </section>
        </div>
      )}

      {aviso && (
        <div class={`aviso-flutuante${aviso.erro ? ' erro' : ''}`} role="status" aria-live="polite">
          {aviso.texto}
        </div>
      )}
    </>
  );
}
