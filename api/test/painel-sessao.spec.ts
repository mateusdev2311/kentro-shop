import { montarTela, OpcoesTela, Tela } from './omni-falso';

const config = { api_url: 'https://api.teste', chave_atendimento: 'ksk_abc' };
const lojaOk = { status: 200, body: { id: 'l1', nome: 'Pisos & Cia', status: 'ativa', plano: 'gratis', papel: 'atendimento' } };
const agora = new Date().toISOString();
const futuro = new Date(Date.now() + 86_400_000).toISOString();

function sessao(extra: Record<string, unknown> = {}) {
  return {
    id: 's1',
    status: 'navegando',
    url: 'https://shop.teste/c/tok123',
    cliente: { nome: 'Ana Souza', telefone: '5538988887777' },
    itens: [
      {
        produtoId: 'A1',
        variacaoId: null,
        sku: 'A1',
        nome: 'Porcelanato Bege',
        variacaoNome: null,
        imagem: null,
        unidade: 'CX',
        precoUnitario: 129.9,
        quantidade: 2,
        subtotal: 259.8,
        m2: 2.88,
      },
    ],
    totais: { itens: 2, subtotal: 259.8, frete: null, desconto: 0, total: 259.8 },
    checkout: null,
    eventos: [
      { em: agora, texto: 'Adicionou 2 caixas de Porcelanato Bege', autor: 'cliente' },
      { em: agora, texto: 'Cliente abriu o catálogo', autor: 'cliente' },
    ],
    resumo: 'Resumo do atendimento\n\nCliente: Ana Souza',
    abertaEm: agora,
    finalizadaEm: null,
    expiraEm: futuro,
    ...extra,
  };
}

const finalizada = () =>
  sessao({
    status: 'finalizado',
    finalizadaEm: agora,
    checkout: {
      tipo: 'entrega',
      entrega: { nome: 'Ana Souza', telefone: '(38) 98888-7777', cep: '39400-000', estado: 'MG', cidade: 'Montes Claros', bairro: 'Centro', rua: 'Rua A', numero: '10', complemento: '', referencia: '' },
      observacoes: 'Entregar sábado',
    },
  });

const rota = (chatId: string | number) => `GET /v1/sessoes/chat/${chatId}`;
const semSessao = { status: 404, body: { erro: { codigo: 'SEM_SESSAO', mensagem: 'Nenhum link.' } } };

describe('painel do atendimento — sessão do catálogo', () => {
  let tela: Tela;
  const montar = async (opcoes: Partial<OpcoesTela>) => {
    tela = await montarTela('atendimento/painel.html', { config, intervaloMs: 30, ...opcoes, respostas: { 'GET /v1/loja': lojaOk, ...opcoes.respostas } });
    await tela.esperar(5);
    return tela;
  };
  const consultas = (chatId: string | number) => tela.chamadas.filter((c) => c.url.endsWith(`/v1/sessoes/chat/${chatId}`)).length;
  afterEach(() => tela?.fechar());

  it('sem atendimento aberto pede para abrir um', async () => {
    await montar({ chat: null });
    expect(tela.visivel('sem-chat')).toBe(true);
    expect(tela.texto('status')).toBe('Conectado à loja Pisos & Cia.');
    expect(tela.chamadas.map((c) => c.url)).toEqual(['https://api.teste/v1/loja']);
  });

  it('sem sessão (404 pelo proxy da Kentro) mostra o botão; gerar envia chatId, nome e telefone do contato e copia o link', async () => {
    await montar({
      proxy: 'kentro',
      chat: { id: 55, contactId: 9, contact: { name: 'Ana', phone: '' } },
      contatos: { '9': { name: 'Ana Souza', phone: '+55 (38) 98888-7777' } },
      respostas: { [rota(55)]: semSessao, 'POST /v1/sessoes': { status: 201, body: sessao({ status: 'link_enviado', itens: [], abertaEm: null }) } },
    });
    expect(tela.visivel('sem-sessao')).toBe(true);
    // Como o servidor real: depois do POST a consulta do chat devolve a sessão criada.
    tela.respostas[rota(55)] = tela.respostas['POST /v1/sessoes'];
    await tela.clicar('btn-gerar');
    const post = tela.chamadas.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({ chatId: '55', nome: 'Ana Souza', telefone: '5538988887777' });
    expect(tela.visivel('com-sessao')).toBe(true);
    expect(tela.valor('link')).toBe('https://shop.teste/c/tok123');
    expect(tela.texto('status-sessao')).toBe('Link enviado');
    expect(tela.copiados).toEqual(['https://shop.teste/c/tok123']);
    expect(tela.toasts).toEqual(['Link copiado. Cole na conversa para enviar ao cliente.']);
  });

  it('pré-cadastro: envia e-mail, documento e endereço do contato da Kentro ao gerar o link', async () => {
    await montar({
      chat: { id: 56, contactId: 9 },
      contatos: {
        '9': {
          name: 'Ana Souza',
          phone: '5538988887777',
          email: 'ana@x.com',
          document: '123.456.789-00',
          postalCode: '39400-000',
          address: 'Rua A',
          houseNumber: '10',
          addressComplement: '',
          neighborhood: 'Centro',
          city: 'Montes Claros',
          state: 'mg',
        } as never,
      },
      respostas: { [rota(56)]: semSessao, 'POST /v1/sessoes': { status: 201, body: sessao({ status: 'link_enviado', itens: [] }) } },
    });
    tela.respostas[rota(56)] = tela.respostas['POST /v1/sessoes'];
    await tela.clicar('btn-gerar');
    const post = tela.chamadas.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({
      chatId: '56',
      nome: 'Ana Souza',
      telefone: '5538988887777',
      email: 'ana@x.com',
      documento: '123.456.789-00',
      endereco: { cep: '39400-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Montes Claros', estado: 'MG' },
    });
  });

  it('erro ao gerar o link aparece no aviso', async () => {
    await montar({
      chat: { id: 55 },
      respostas: { [rota(55)]: semSessao, 'POST /v1/sessoes': { status: 403, body: { erro: { codigo: 'LOJA_BLOQUEADA', mensagem: 'x' } } } },
    });
    await tela.clicar('btn-gerar');
    expect(tela.texto('aviso')).toBe('Esta loja está bloqueada no Kentro Shop. Fale com o administrador.');
    expect((tela.document.getElementById('btn-gerar') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sessão navegando mostra itens, totais com frete a combinar e a atividade; e segue consultando', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    expect(tela.texto('status-sessao')).toBe('Montando o carrinho');
    expect(tela.texto('itens')).toContain('Porcelanato Bege');
    expect(tela.texto('itens')).toContain('2 cx × R$ 129,90 · 2,88 m²');
    expect(tela.texto('carrinho-qtd')).toBe('2 itens');
    const frete = [...tela.document.querySelectorAll('#totais div')].find((d) => d.textContent?.startsWith('Frete'));
    expect(frete?.lastElementChild?.textContent).toBe('a combinar');
    expect(tela.texto('eventos')).toContain('Adicionou 2 caixas de Porcelanato Bege');
    expect(tela.visivel('secao-handoff')).toBe(false);
    const antes = consultas(55);
    await tela.esperar(100);
    expect(consultas(55)).toBeGreaterThan(antes);
  });

  it('finalizado mostra o handoff, avisa uma vez e para de consultar', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    tela.respostas[rota(55)] = { status: 200, body: finalizada() };
    await tela.esperar(80);
    expect(tela.texto('status-sessao')).toBe('Finalizado');
    expect(tela.visivel('secao-handoff')).toBe(true);
    expect(tela.texto('handoff')).toContain('Rua A, nº 10 — Centro — Montes Claros/MG');
    expect(tela.texto('handoff')).toContain('(38) 98888-7777');
    expect(tela.texto('handoff')).toContain('Entregar sábado');
    expect(tela.toasts).toEqual(['O cliente finalizou o pedido: R$ 259,80']);
    const depois = consultas(55);
    await tela.esperar(120);
    expect(consultas(55)).toBe(depois);
    await tela.clicar('btn-copiar-resumo');
    expect(tela.copiados).toEqual(['Resumo do atendimento\n\nCliente: Ana Souza']);
  });

  it('abrir um atendimento já finalizado não dispara o aviso', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: finalizada() } } });
    expect(tela.visivel('secao-handoff')).toBe(true);
    expect(tela.toasts).toEqual([]);
  });

  it('trocar de atendimento zera a tela e consulta o novo', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() }, [rota(77)]: semSessao } });
    expect(tela.visivel('com-sessao')).toBe(true);
    await tela.emitir('omniChatSelected', { id: 77 });
    expect(consultas(77)).toBe(1);
    expect(tela.visivel('com-sessao')).toBe(false);
    expect(tela.visivel('sem-sessao')).toBe(true);
    await tela.emitir('omniChatSelected', null);
    expect(tela.visivel('sem-chat')).toBe(true);
    expect(tela.visivel('sem-sessao')).toBe(false);
  });

  it('com a aba oculta pausa a consulta; ao voltar, consulta na hora', async () => {
    // Intervalo maior que o tempo das asserções: a consulta "na hora" não se confunde com a agendada.
    await montar({ intervaloMs: 250, chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao() } } });
    await tela.ocultar(true);
    const pausado = consultas(55);
    await tela.esperar(600);
    expect(consultas(55)).toBe(pausado);
    await tela.ocultar(false);
    expect(consultas(55)).toBe(pausado + 1);
  });

  it('link expirado mostra "Gerar novo link" e não fica consultando', async () => {
    await montar({ chat: { id: 55 }, respostas: { [rota(55)]: { status: 200, body: sessao({ expiraEm: new Date(Date.now() - 1000).toISOString() }) } } });
    expect(tela.texto('status-sessao')).toBe('Link expirado');
    expect(tela.visivel('btn-novo-link')).toBe(true);
    const total = consultas(55);
    await tela.esperar(100);
    expect(consultas(55)).toBe(total);
  });
});
