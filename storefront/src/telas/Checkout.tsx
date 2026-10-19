import { useEffect, useRef, useState } from 'preact/hooks';
import type { Api } from '../api';
import { ehErroDaApi } from '../api';
import type { EnderecoCep } from '../cep';
import { brl, cep as formatarCep, telefone } from '../formato';
import { precos } from '../precos';
import type { Abertura, CorpoFinalizar, CotacaoFrete, DadosEntrega, Sessao } from '../tipos';

interface Props {
  abertura: Abertura;
  sessao: Sessao;
  subtotal: number;
  api: Pick<Api, 'frete'>;
  buscarCep: (cep: string) => Promise<EnderecoCep | null>;
  aoEnviar: (corpo: CorpoFinalizar) => Promise<void>;
  aoVoltar: () => void;
}

type Tipo = 'entrega' | 'retirada';
type Campo = keyof DadosEntrega;

export function Checkout({ abertura, sessao, subtotal, api, buscarCep, aoEnviar, aoVoltar }: Props) {
  const opcoes: Tipo[] = [];
  if (abertura.entrega.habilitada) opcoes.push('entrega');
  if (abertura.retirada.habilitada && abertura.retirada.lojas.length) opcoes.push('retirada');

  const [tipo, setTipo] = useState<Tipo | ''>(opcoes.length === 1 ? opcoes[0] : '');
  // Pré-cadastro: o endereço que a Kentro já tem do contato entra preenchido.
  const pre = sessao.cliente.endereco ?? {};
  const [dados, setDados] = useState<DadosEntrega>({
    nome: sessao.cliente.nome,
    telefone: telefone(sessao.cliente.telefone),
    cep: formatarCep(pre.cep ?? ''),
    estado: (pre.estado ?? '').toUpperCase(),
    cidade: pre.cidade ?? '',
    bairro: pre.bairro ?? '',
    rua: pre.rua ?? '',
    numero: pre.numero ?? '',
    complemento: pre.complemento ?? '',
    referencia: '',
  });
  const [lojaId, setLojaId] = useState('');
  const [observacoes, setObservacoes] = useState('');
  // Pedido criado na loja: a plataforma pede o e-mail do comprador (vem do cadastro da Kentro, quando há).
  const pedidoNaLoja = !!abertura.pedidoNaLoja;
  const [email, setEmail] = useState(sessao.cliente.email ?? '');
  const aCombinar = abertura.frete.regra === 'a_combinar';
  const [frete, setFrete] = useState<CotacaoFrete | null>(aCombinar ? { titulo: 'Frete a combinar', valor: null, prazo: abertura.frete.prazo } : null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );

  const mudar = (campo: Campo, valor: string) => setDados((d) => ({ ...d, [campo]: valor }));

  function cotar(digitos: string) {
    if (aCombinar) return;
    void api
      .frete(digitos)
      .then((f) => montado.current && setFrete(f))
      .catch(() => undefined);
  }

  // CEP vindo do pré-cadastro: cota o frete logo ao abrir.
  useEffect(() => {
    const digitos = dados.cep.replace(/\D/g, '');
    if (digitos.length === 8) cotar(digitos);
  }, []);

  const [escolhido, setEscolhido] = useState<number | null>(null);

  function usarEndereco(i: number) {
    const e = abertura.historico.enderecos[i];
    setEscolhido(i);
    setDados((d) => ({
      ...d,
      cep: formatarCep(e.cep),
      estado: e.estado.toUpperCase(),
      cidade: e.cidade,
      bairro: e.bairro,
      rua: e.rua,
      numero: e.numero,
      complemento: e.complemento,
      referencia: e.referencia,
    }));
    const digitos = e.cep.replace(/\D/g, '');
    if (digitos.length === 8) cotar(digitos);
  }

  function mudarCep(valor: string) {
    const formatado = formatarCep(valor);
    mudar('cep', formatado);
    const digitos = formatado.replace(/\D/g, '');
    if (digitos.length !== 8) return;
    // ViaCEP só preenche o que está vazio; falha = preenchimento manual.
    void buscarCep(digitos)
      .then((e) => {
        if (!e || !montado.current) return;
        setDados((d) => ({
          ...d,
          rua: d.rua || e.rua,
          bairro: d.bairro || e.bairro,
          cidade: d.cidade || e.cidade,
          estado: d.estado || e.estado,
        }));
      })
      .catch(() => undefined);
    cotar(digitos);
  }

  async function enviar() {
    setErro('');
    if (!tipo) return setErro('Escolha entrega ou retirada.');
    if (tipo === 'retirada' && !lojaId) return setErro('Escolha a loja para retirada.');
    if (pedidoNaLoja && !/^\S+@\S+\.\S+$/.test(email.trim())) return setErro('Informe o seu e-mail para receber o pedido.');
    const base: CorpoFinalizar = tipo === 'entrega' ? { tipo, entrega: dados, observacoes } : { tipo, lojaRetiradaId: lojaId, observacoes };
    const corpo: CorpoFinalizar = pedidoNaLoja ? { ...base, email: email.trim() } : base;
    setEnviando(true);
    try {
      await aoEnviar(corpo);
    } catch (e) {
      if (montado.current) setErro(ehErroDaApi(e) ? e.mensagem : 'Não foi possível enviar. Tente de novo.');
    } finally {
      if (montado.current) setEnviando(false);
    }
  }

  const valorFrete = tipo === 'entrega' ? (frete?.valor ?? 0) : 0;
  const comPreco = precos.visiveis();
  const campo = (id: Campo, rotulo: string, extra: Record<string, unknown> = {}) => (
    <>
      <label class="campo" for={`f-${id}`}>
        {rotulo}
      </label>
      <input class="entrada" id={`f-${id}`} value={dados[id]} onInput={(e) => mudar(id, e.currentTarget.value)} {...extra} />
    </>
  );

  return (
    <div class="carrinho">
      <button type="button" class="botao-texto voltar" onClick={aoVoltar}>
        ‹ Voltar ao carrinho
      </button>
      <h2 id="carrinho-titulo">Como você prefere receber?</h2>
      <div class={`opcoes${opcoes.length === 1 ? ' uma' : ''}`}>
        {opcoes.includes('entrega') && (
          <button type="button" class={`opcao${tipo === 'entrega' ? ' ativa' : ''}`} aria-pressed={tipo === 'entrega'} onClick={() => setTipo('entrega')}>
            <strong>Entrega</strong>
            <small>Levamos até você</small>
          </button>
        )}
        {opcoes.includes('retirada') && (
          <button type="button" class={`opcao${tipo === 'retirada' ? ' ativa' : ''}`} aria-pressed={tipo === 'retirada'} onClick={() => setTipo('retirada')}>
            <strong>Retirada</strong>
            <small>Em uma das lojas</small>
          </button>
        )}
      </div>

      {tipo === 'entrega' && abertura.historico.enderecos.length > 0 && (
        <div class="enderecos-salvos">
          <label class="campo">Usar um endereço salvo</label>
          {abertura.historico.enderecos.map((e, i) => (
            <button type="button" key={i} class={`endereco-salvo${escolhido === i ? ' ativa' : ''}`} aria-pressed={escolhido === i} onClick={() => usarEndereco(i)}>
              <strong>
                {e.rua}
                {e.numero ? `, ${e.numero}` : ''}
              </strong>
              <small>{[e.bairro, e.cidade && `${e.cidade}/${e.estado}`, e.cep].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </div>
      )}

      {tipo === 'entrega' && (
        <form onSubmit={(e) => e.preventDefault()} noValidate>
          {campo('nome', 'Nome completo', { autocomplete: 'name', maxLength: 120 })}
          {campo('telefone', 'Telefone / WhatsApp', { type: 'tel', autocomplete: 'tel', maxLength: 30 })}
          <div class="linha">
            <div>
              <label class="campo" for="f-cep">
                CEP
              </label>
              <input
                class="entrada"
                id="f-cep"
                inputMode="numeric"
                autocomplete="postal-code"
                maxLength={9}
                value={dados.cep}
                onInput={(e) => mudarCep(e.currentTarget.value)}
              />
            </div>
            <div class="estreito">{campo('estado', 'UF', { maxLength: 2, autocomplete: 'address-level1' })}</div>
          </div>
          {campo('cidade', 'Cidade', { autocomplete: 'address-level2', maxLength: 80 })}
          {campo('bairro', 'Bairro', { maxLength: 80 })}
          <div class="linha">
            <div>{campo('rua', 'Rua', { autocomplete: 'address-line1', maxLength: 120 })}</div>
            <div class="estreito">{campo('numero', 'Número', { maxLength: 20 })}</div>
          </div>
          {campo('complemento', 'Complemento (opcional)', { autocomplete: 'address-line2', maxLength: 80 })}
          {campo('referencia', 'Ponto de referência (opcional)', { maxLength: 160 })}
        </form>
      )}

      {tipo === 'retirada' &&
        abertura.retirada.lojas.map((l) => (
          <button type="button" key={l.id} class={`loja${lojaId === l.id ? ' ativa' : ''}`} aria-pressed={lojaId === l.id} onClick={() => setLojaId(l.id)}>
            <strong>{l.nome}</strong>
            <small>{l.endereco}</small>
            {l.horario && <small>{l.horario}</small>}
            {lojaId === l.id && l.orientacoes && <small style={{ marginTop: '6px' }}>{l.orientacoes}</small>}
          </button>
        ))}

      {tipo && (
        <>
          {pedidoNaLoja && (
            <>
              <label class="campo" for="f-email">
                E-mail
              </label>
              <input
                class="entrada"
                id="f-email"
                type="email"
                inputMode="email"
                autocomplete="email"
                maxLength={120}
                value={email}
                onInput={(e) => setEmail(e.currentTarget.value)}
              />
              <small class="dica">A loja envia a confirmação do pedido e do pagamento para este e-mail.</small>
            </>
          )}
          <label class="campo" for="f-observacoes">
            Observações (opcional)
          </label>
          <textarea
            class="entrada"
            id="f-observacoes"
            maxLength={500}
            placeholder="Ex.: preciso para sábado, tem escada…"
            value={observacoes}
            onInput={(e) => setObservacoes(e.currentTarget.value)}
          />
          {comPreco && (
          <div class="totais">
            <div>
              <span>Produtos</span>
              <span>{brl(subtotal)}</span>
            </div>
            {tipo === 'entrega' ? (
              <>
                <div>
                  <span>{frete?.titulo ?? 'Entrega'}</span>
                  <span>{!frete ? 'informe o CEP' : frete.valor === null ? 'a combinar' : frete.valor === 0 ? 'Grátis' : brl(frete.valor)}</span>
                </div>
                {frete?.prazo && (
                  <div class="dica">
                    <span>{frete.prazo}</span>
                  </div>
                )}
              </>
            ) : (
              <div>
                <span>Retirada na loja</span>
                <span>Grátis</span>
              </div>
            )}
            <div class="total">
              <span>Total</span>
              <span>{brl(subtotal + valorFrete)}</span>
            </div>
          </div>
          )}
        </>
      )}
      {erro && (
        <div class="erro-form" role="alert">
          {erro}
        </div>
      )}
      {tipo && (
        <>
          <button type="button" class="botao primario largo" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? 'Enviando…' : pedidoNaLoja ? 'Fechar pedido e ir para o pagamento' : comPreco ? 'Enviar pedido para o atendente' : 'Enviar pedido de orçamento'}
          </button>
          <p class="dica" style={{ textAlign: 'center' }}>
            {pedidoNaLoja
              ? 'Você paga no site da loja, com as formas de pagamento dela. O atendente acompanha pelo WhatsApp.'
              : comPreco
                ? 'O pagamento é combinado com o atendente pelo WhatsApp.'
                : 'O atendente envia os valores e o frete pela conversa.'}
          </p>
        </>
      )}
    </div>
  );
}
