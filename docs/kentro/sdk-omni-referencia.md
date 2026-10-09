# Referência de `omni.*`

Todo método que uma extensão pode chamar. Esta página é **gerada** do mesmo catálogo que produz
o SDK injetado no contêiner, o roteador de comandos da aplicação e a ferramenta `list_api` do
assistente de IA: se um método está aqui, ele existe; se não está, a chamada responde
`unknown_method`.

**Tudo devolve Promise**, inclusive o que o SDK resolve sozinho, sem tocar a aplicação. Escreva
sempre com `await` ou `.then()`.

## Como ler cada entrada

Depois da descrição vem uma linha com a natureza do método e a versão do SDK em que ele
apareceu. A natureza importa por causa do preview:

- **`read`** — leitura. Passa direto, inclusive na Bancada.
- **`write`** — escrita. O modo somente-leitura da Bancada a curto-circuita, devolvendo sucesso
  simulado sem tocar a instância.
- **`ui`** — abre algo na interface da aplicação. Roda de verdade na Bancada, que é o ponto do
  preview; a exceção é o diálogo que grava com a Bancada em somente-leitura.
- **`local`** — resolvido dentro do próprio SDK, sem ida e volta até a aplicação. É barato.

Duas marcas aparecem quando cabem:

- **worker** — o método só existe no worker, onde rodam as contribuições de código.
- **Bancada** — o método só existe na Bancada. Em produção ele **não existe** no objeto `omni`,
  o que é justamente o que faz a detecção por inspeção funcionar.

## Detecte o recurso, nunca a versão

A mesma extensão publicada uma vez roda em instâncias com versões diferentes da aplicação, cada
uma injetando o seu próprio SDK. Você não escolhe o SDK e não existe negociação de versão.
Antes de usar algo que pode não estar lá:

```js
if (omni.tickets && typeof omni.tickets.openForm === 'function') {
  await omni.tickets.openForm({ prefill: { subject: 'Cobrança indevida' } });
} else {
  // caminho alternativo para instâncias mais antigas
}
```

## Erros

Toda rejeição é um `Error` com um `code` estável: `unknown_method`, `bad_args`, `forbidden`,
`not_found`, `http_error`, `rate_limited`, `readonly`, `timeout` e `internal`. O que fazer em
cada um está no artigo **Ciclo de vida**.

`forbidden` e `not_found` não são exceções raras: numa aplicação em que cada usuário enxerga uma
fatia diferente do mundo, eles são estados normais. Trate-os.

## `root` — chamadas diretas em `omni`

### `omni.ready(cb)`

Registra um callback disparado quando o handshake com a aplicação termina; se o handshake já aconteceu, o callback roda na próxima microtask, nunca de forma reentrante.

`local` · desde 1.0.0

**Parâmetros**

- `cb` — `function`, obrigatório. Callback que recebe o contexto do handshake: usuário, tema, locale, configuração da instalação, contribuição montada e instância.

**Retorna:** Função de cancelamento

```js
omni.ready(async (ctx) => {
  document.body.dataset.theme = ctx.theme.mode;
  const user = await omni.session.getUser();
  console.log('Olá, ' + user.name);
});
```

### `omni.on(evento, cb)`

Assina um evento de domínio da aplicação; o host só transmite eventos assinados e só entrega eventos sobre objetos que o usuário da sessão pode ver.

`local` · desde 1.0.0

**Parâmetros**

- `evento` — `string`, obrigatório. Nome do evento, conforme o catálogo de eventos.
- `cb` — `function`, obrigatório. Função que recebe o payload do evento.

**Retorna:** Função de cancelamento

```js
omni.on('omniChatSelected', async (chat) => {
  const msgs = await omni.chats.getMessages(chat.id, { limit: 20 });
  render(msgs);
});
```

### `omni.off(evento, cb?)`

Cancela a assinatura de um evento; quando o último callback sai, o SDK avisa o host.

`local` · desde 1.0.0

**Parâmetros**

- `evento` — `string`, obrigatório. Nome do evento.
- `cb` — `function`, opcional. Callback específico; omitido, remove todos os callbacks daquele evento.

**Retorna:** void

```js
const aoSelecionar = (chat) => console.log(chat.id);
omni.on('omniChatSelected', aoSelecionar);
omni.off('omniChatSelected', aoSelecionar);
```

### `omni.runAutomation(idOuSlug, vars?, payload?)`

Executa uma automação no servidor em contexto ADMINISTRATIVO, ignorando as permissões do usuário logado — é a única exceção consciente ao modelo de permissão, então valide os argumentos antes de chamar. Use `vars` para um punhado de chaves soltas e `payload` para entregar uma estrutura inteira (a resposta de um ERP, uma cesta recalculada) sem achatá-la em chaves de primeiro nível. O fluxo também recebe extension_id, extension_install_id e extension_label, para um fluxo compartilhado saber qual extensão o disparou.

`write` · desde 1.0.0

**Parâmetros**

- `idOuSlug` — `number | string`, obrigatório. Id numérico ou identificador textual da automação.
- `vars` — `object`, opcional. Variáveis entregues à automação, uma chave por variável de fluxo.
- `payload` — `object | array`, opcional. Objeto JSON arbitrario entregue ao fluxo em UMA variavel: extension_payload (o objeto, para os elementos que leem estrutura) e extension_payload_json (o mesmo, serializado, para condicao de variavel, texto de mensagem e requisicao HTTP). Limite de 256 KB serializados; acima disso a chamada e recusada, nao truncada.

**Retorna:** Resultado devolvido pela automação

```js
const r = await omni.runAutomation('confere-preco', { origem: 'painel' }, {
  itens: [{ codigo: 'CAFE-KG', qtd: 0.5 }],
  cliente: { cnpj: '00.000.000/0001-00' }
});
```

## `session` — sessão, usuário e instância

### `omni.session.getUser()`

Devolve o usuário da sessão; vem do handshake, sem gerar tráfego na bridge.

`local` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {id, name, type, email, queues[], groups[]}

```js
const user = await omni.session.getUser();
if (user.type === 2) { mostrarPainelDoAgente(); }
```

### `omni.session.getPermissions()`

Devolve as permissões efetivas do usuário da sessão, para esconder o que ele não pode fazer — a permissão de verdade é sempre aplicada no servidor.

`local` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {isAdmin, isSupervisor, isSuperAdmin, flags can*}

```js
const perm = await omni.session.getPermissions();
if (perm.isSupervisor) { mostrarPainelDeFila(); }
```

### `omni.session.getLocale()`

Devolve o locale da interface no formato BCP 47, por exemplo pt-BR.

`local` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** string

```js
const locale = await omni.session.getLocale();
const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' });
```

### `omni.session.getTheme()`

Devolve o tema corrente — modo claro ou escuro e os tokens de cor da marca, os mesmos publicados como custom properties no documento — e fica atualizado sozinho.

`local` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {mode, tokens}

```js
const tema = await omni.session.getTheme();
document.body.classList.toggle('escuro', tema.mode === 'dark');
```

### `omni.session.getInstance()`

Devolve a identificação da instância em que a extensão está rodando.

`local` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {name, domain, hostVersion, viewVersion}

```js
const inst = await omni.session.getInstance();
console.log('rodando em ' + inst.domain);
```

## `nav` — navegação da aplicação

### `omni.nav.getRoute()`

Devolve a rota corrente da aplicação.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {path, params, query}

```js
const { path } = await omni.nav.getRoute();
if (path.startsWith('/crm')) { mostrarAtalhosDeCrm(); }
```

### `omni.nav.navigate(rota, query?)`

Navega a aplicação para outra rota; para abrir algo da própria extensão use omni.ui.openContribution.

`ui` · desde 1.0.0

**Parâmetros**

- `rota` — `string | string[]`, obrigatório. Caminho, ou array de segmentos de caminho.
- `query` — `object`, opcional. Parâmetros de query string.

**Retorna:** {navigated: boolean}

```js
await omni.nav.navigate(['crm', 'oportunidades'], { funil: 3 });
```

### `omni.nav.openFullscreen(contributionId, params?)`

Abre uma contribuição desta extensão ocupando a área abaixo do menu superior.

`ui` · desde 1.0.0

**Parâmetros**

- `contributionId` — `string`, obrigatório. Id da contribuição declarada no manifest desta extensão.
- `params` — `object`, opcional. Parâmetros entregues à contribuição no handshake.

**Retorna:** {opened: boolean}

```js
await omni.nav.openFullscreen('conciliacao', { mes: '2026-08' });
```

## `chats` — atendimentos

### `omni.chats.getSelected()`

Devolve o atendimento aberto na tela, ou null se nenhum estiver selecionado.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** Chat normalizado: {id, queueId, contactId, userId, status, sessionLocked, channel, protocol, startedAt, hasTelegram, lastMessageAt, unread, contact}. `hasTelegram`: 1 o telefone do cliente tem Telegram, 0 não foi possível confirmar (a consulta só encontra quem permite ser achado por telefone — NÃO é prova de que a pessoa não tem), -1 a verificação ainda não respondeu (comum no primeiro atendimento do número), null a fila não faz essa verificação. O valor pode MUDAR depois da abertura do atendimento — a consulta é assíncrona — e não existe evento de alteração de atendimento: se a extensão precisar do valor final, releia com `omni.chats.get(id)` no momento em que for usar, ou null

```js
const chat = await omni.chats.getSelected();
if (chat) { carregarTitulos(chat.contactId); }
```

### `omni.chats.select(chatId)`

Abre um atendimento na tela do usuário.

`ui` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.

**Retorna:** {selected: boolean}

```js
await omni.chats.select(1234);
```

### `omni.chats.get(chatId)`

Devolve um atendimento pelo id; rejeita com not_found se o usuário não puder vê-lo.

`read` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.

**Retorna:** Chat normalizado: {id, queueId, contactId, userId, status, sessionLocked, channel, protocol, startedAt, hasTelegram, lastMessageAt, unread, contact}. `hasTelegram`: 1 o telefone do cliente tem Telegram, 0 não foi possível confirmar (a consulta só encontra quem permite ser achado por telefone — NÃO é prova de que a pessoa não tem), -1 a verificação ainda não respondeu (comum no primeiro atendimento do número), null a fila não faz essa verificação. O valor pode MUDAR depois da abertura do atendimento — a consulta é assíncrona — e não existe evento de alteração de atendimento: se a extensão precisar do valor final, releia com `omni.chats.get(id)` no momento em que for usar

```js
const chat = await omni.chats.get(1234);
```

### `omni.chats.listMine()`

Lista os atendimentos do próprio usuário.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** Chat[]

```js
const meus = await omni.chats.listMine();
console.log(meus.length + ' atendimentos abertos');
```

### `omni.chats.listByQueue(queueId)`

Lista os atendimentos de uma fila; exige perfil de supervisor, caso contrário rejeita com forbidden.

`read` · desde 1.0.0

**Parâmetros**

- `queueId` — `number`, obrigatório. Id da fila.

**Retorna:** Chat[]

```js
const perm = await omni.session.getPermissions();
if (perm.isSupervisor) {
  const daFila = await omni.chats.listByQueue(12);
}
```

### `omni.chats.getMessages(chatId, opts?)`

Devolve uma página do histórico de mensagens, da mais recente para a mais antiga. Message normalizada: {id, dbId, chatId, direction, text, at, userId, status, fileRef, fileName, mimetype, fileSize, order, cart, productCodes, quotedId, quotedText, reaction, buttons, subject, header, footer, oldText, transcription, card, preview, hasLinkPreview, location, sharedContactId, attachments, ad, participant, participantName, automationId, assistantId, rewrittenByAi, deleted, deletedBy, viewOnce, insultDetected, signatureInvalid, unsupported, error, readBy, channel, replyTo, form}. As chaves saem sempre, com nulo ou vazio quando nao se aplicam. Valores de dinheiro em order saem na unidade da moeda, nao em centavos.

`read` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.
- `opts` — `object`, opcional. limit, que vale 50 por padrão, e before, o id da mensagem usada como corte.

**Retorna:** Message[]

```js
const msgs = await omni.chats.getMessages(1234, { limit: 50 });
const ultima = msgs[msgs.length - 1];
const anteriores = await omni.chats.getMessages(1234, { limit: 50, before: ultima.id });
```

### `omni.chats.getMessage(chatId, msgId)`

Devolve uma mensagem específica de um atendimento.

`read` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.
- `msgId` — `number | string`, obrigatório. Id da mensagem.

**Retorna:** Message

```js
const msg = await omni.chats.getMessage(1234, 98765);
```

### `omni.chats.getFile(fileRef)`

Resolve o arquivo de uma mensagem numa URL temporária servida pelo host; a extensão nunca recebe credencial para buscar o arquivo por conta própria.

`read` · desde 1.0.0

**Parâmetros**

- `fileRef` — `string | number`, obrigatório. Referência do arquivo, vinda do campo fileRef da mensagem.

**Retorna:** {url, mimetype, name, size}

```js
const msg = await omni.chats.getMessage(1234, 98765);
if (msg.fileRef) {
  const arq = await omni.chats.getFile(msg.fileRef);
  document.querySelector('img').src = arq.url;
}
```

### `omni.chats.sendMessage(chatId, payload)`

Envia uma mensagem no atendimento, como se o usuário da sessão a tivesse enviado.

`write` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.
- `payload` — `object`, obrigatório. text, fileUrl, fileName e type; é obrigatório informar pelo menos text ou fileUrl.

**Retorna:** {sent: true, id}

```js
await omni.chats.sendMessage(1234, { text: 'Segunda via enviada por e-mail.' });
```

### `omni.chats.end(chatId, opts?)`

Encerra um atendimento.

`write` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.
- `opts` — `object`, opcional. reasonId, o motivo de encerramento configurado na instância.

**Retorna:** {ended: true}

```js
await omni.chats.end(1234, { reasonId: 7 });
```

### `omni.chats.transfer(chatId, destino)`

Transfere um atendimento para outra fila ou para outro usuário.

`write` · desde 1.0.0

**Parâmetros**

- `chatId` — `number`, obrigatório. Id do atendimento.
- `destino` — `object`, obrigatório. Objeto com queueId, para transferir para uma fila, ou com userId, para transferir para um usuário.

**Retorna:** {transferred: true}

```js
await omni.chats.transfer(1234, { queueId: 12 });
```

## `contacts` — contatos e empresas

### `omni.contacts.get(id)`

Devolve um contato pelo id.

`read` · desde 1.0.0

**Parâmetros**

- `id` — `number`, obrigatório. Id do contato.

**Retorna:** Contact

```js
const contato = await omni.contacts.get(42);
```

### `omni.contacts.search(termo, opts?)`

Busca contatos por nome, telefone ou e-mail.

`read` · desde 1.0.0

**Parâmetros**

- `termo` — `string`, obrigatório. Texto buscado em nome, telefone e e-mail.
- `opts` — `object`, opcional. limit, que vale 20 por padrão.

**Retorna:** Contact[]

```js
const achados = await omni.contacts.search('acme', { limit: 10 });
```

### `omni.contacts.openForm(opts)`

Abre o formulário de contato: com id edita, com prefill cria; nada é gravado sem o usuário confirmar, e saved indica se ele confirmou.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. Informe id para editar um contato existente, ou prefill com os campos já preenchidos para criar um novo.

**Retorna:** {saved: boolean, id}

```js
const r = await omni.contacts.openForm({ prefill: { name: 'ACME', phone: '5511999998888' } });
if (r.saved) { console.log('contato ' + r.id + ' criado'); }
```

### `omni.contacts.openCompany(opts)`

Abre o formulário de empresa, com a mesma semântica de omni.contacts.openForm.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `number | object`, obrigatório. Id da empresa, ou objeto com id para editar, ou objeto com prefill para criar.

**Retorna:** {saved: boolean, id}

```js
const r = await omni.contacts.openCompany({ prefill: { name: 'ACME Software' } });
```

### `omni.contacts.update(id, campos, opts?)`

Altera um contato direto, sem abrir formulario: grava apenas os campos informados e deixa os demais como estao. tags e groups SUBSTITUEM a lista inteira, nao acrescentam; extraFields e a excecao, e e MESCLADO sobre os campos extras que ja existem.

`write` · desde 1.1.0

**Parâmetros**

- `id` — `number`, obrigatório. Id do contato.
- `campos` — `object`, obrigatório. Somente os campos a alterar. Aceita name, phone, email, document, companyId, comments, birthdate, postalCode, address, houseNumber, addressComplement, neighborhood, city, state, country, instagram, facebook, free1, free2, doNotDisturb, blockMarketingCampaigns, blockUtilitiesCampaigns, tags, groups e extraFields. Qualquer outro nome e recusado com bad_args.
- `opts` — `object`, opcional. silent, que quando verdadeiro nao mostra o aviso de sucesso ao usuario; o padrao e falso.

**Retorna:** {updated: true, id}

```js
await omni.contacts.update(431, { email: 'financeiro@acme.com', tags: [3, 7] });
await omni.contacts.update(431, { comments: 'sincronizado com o ERP' }, { silent: true });
```

## `crm` — funis e oportunidades

### `omni.crm.listPipelines()`

Lista os funis de CRM visíveis ao usuário.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** Pipeline[]

```js
const funis = await omni.crm.listPipelines();
```

### `omni.crm.listStages(pipelineId)`

Lista as etapas de um funil.

`read` · desde 1.0.0

**Parâmetros**

- `pipelineId` — `number`, obrigatório. Id do funil.

**Retorna:** Stage[]

```js
const etapas = await omni.crm.listStages(3);
```

### `omni.crm.listOpportunities(stageId, filtros?)`

Lista as oportunidades de uma etapa do funil.

`read` · desde 1.0.0

**Parâmetros**

- `stageId` — `number`, obrigatório. Id da etapa.
- `filtros` — `object`, opcional. Filtros adicionais aceitos pelo endpoint de oportunidades.

**Retorna:** Opportunity[]

```js
const oportunidades = await omni.crm.listOpportunities(17, { responsavel: 5 });
```

### `omni.crm.get(id)`

Devolve uma oportunidade pelo id. Opportunity normalizada: {id, title, pipelineId, stageId, companyId, contactIds, contactCount, responsableId, value, recurrentValue, freight, mainPhone, mainMail, origin, tags, status, probability, expectedCloseDate, createdAt}. contactIds sai nulo quando a lista de contatos nao veio na carga enxuta; contactCount esta sempre correto.

`read` · desde 1.0.0

**Parâmetros**

- `id` — `number`, obrigatório. Id da oportunidade.

**Retorna:** Opportunity

```js
const op = await omni.crm.get(881);
```

### `omni.crm.openForm(opts)`

Abre o formulário de oportunidade: com id edita, com prefill cria.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. Informe id para editar, ou prefill para criar já preenchida.

**Retorna:** {saved: boolean, id}

```js
const r = await omni.crm.openForm({ prefill: { title: 'Renovação ACME', value: 1200 } });
```

### `omni.crm.changeStage(id, stageId, opts?)`

Move uma oportunidade para outra etapa do funil.

`write` · desde 1.0.0

**Parâmetros**

- `id` — `number`, obrigatório. Id da oportunidade.
- `stageId` — `number`, obrigatório. Id da etapa de destino.
- `opts` — `object`, opcional. silent, que quando verdadeiro nao mostra o aviso de sucesso ao usuario; o padrao e falso. Exige SDK 1.1.0 — num host mais antigo o parametro e ignorado sem erro.

**Retorna:** {changed: true}

```js
await omni.crm.changeStage(881, 19);
await omni.crm.changeStage(881, 19, { silent: true });
```

### `omni.crm.create(dados, opts?)`

Cria uma oportunidade direto, sem abrir formulario. A etapa, quando omitida, e a primeira do funil. Valores de dinheiro vao na unidade da moeda, nao em centavos. Cada item de products e {id, qty, discount}; desconto recorrente so e gravado depois, por crm.update.

`write` · desde 1.1.0

**Parâmetros**

- `dados` — `object`, obrigatório. pipelineId e title sao obrigatorios. Aceita ainda stageId, description, value, recurrentvalue, freight, probability, expectedclosedate, contacts (lista de ids) ou contactId (um so), companyId, mainphone, mainmail, origin, tags, followers, products e formsdata. Valores de dinheiro na unidade da moeda, e cada item de products e um OBJETO {id, qty, discount} — uma lista de ids soltos e recusada. Qualquer outro nome e recusado com bad_args.
- `opts` — `object`, opcional. silent, que quando verdadeiro nao mostra o aviso de sucesso ao usuario; o padrao e falso.

**Retorna:** {created: true, id}

```js
const itens = await omni.products.select({ caption: 'Itens do pedido' });
const r = await omni.crm.create({
  pipelineId: 3,
  title: 'Pedido 8841',
  value: 1290.5,
  contactId: 431,
  products: itens.products.map(p => ({ id: p.id, qty: 1 }))
});
```

### `omni.crm.update(id, campos, opts?)`

Altera uma oportunidade direto, sem abrir formulario: grava apenas os campos informados e deixa os demais como estao.

`write` · desde 1.1.0

**Parâmetros**

- `id` — `number`, obrigatório. Id da oportunidade.
- `campos` — `object`, obrigatório. Somente os campos a alterar. Aceita title, description, value, recurrentvalue, freight, probability, expectedclosedate, contacts (lista de ids) ou contactId (um so), companyId, mainphone, mainmail, origin, tags, followers, products e formsdata. Etapa, funil e responsavel NAO entram aqui: use crm.changeStage. Valores de dinheiro na unidade da moeda, e cada item de products e um OBJETO {id, qty, discount} — uma lista de ids soltos e recusada. formsdata e MESCLADO sobre as respostas que ja existem. Qualquer outro nome e recusado com bad_args.
- `opts` — `object`, opcional. silent, que quando verdadeiro nao mostra o aviso de sucesso ao usuario; o padrao e falso.

**Retorna:** {updated: true, id}

```js
await omni.crm.update(881, { value: 1450, probability: 80 }, { silent: true });
```

### `omni.crm.win(id, opts?)`

Marca a oportunidade como ganha. Sem confirm nao abre nada; a etapa precisa permitir ganho e o servidor confere a permissao do usuario da sessao.

`write` · desde 1.1.0

**Parâmetros**

- `id` — `number`, obrigatório. Id da oportunidade.
- `opts` — `object`, opcional. value e recurrentValue com os valores de fechamento, que quando omitidos herdam os da propria oportunidade; confirm, que abre o dialogo de ganhar ja preenchido para o usuario conferir; e silent, que nao mostra o aviso de sucesso.

**Retorna:** {won: boolean, cancelled?: true}

```js
await omni.crm.win(881, { value: 1450 });
const r = await omni.crm.win(881, { confirm: true });
if (r.cancelled) { console.log('o usuario desistiu'); }
```

### `omni.crm.lose(id, opts?)`

Marca a oportunidade como perdida. Sem confirm nao abre nada; o servidor confere a permissao do usuario da sessao.

`write` · desde 1.1.0

**Parâmetros**

- `id` — `number`, obrigatório. Id da oportunidade.
- `opts` — `object`, opcional. reason com o motivo da perda, que quando o funil tem lista de motivos precisa ser um deles; obs com a observacao; confirm, que abre o dialogo de perder ja preenchido para o usuario conferir; e silent, que nao mostra o aviso de sucesso.

**Retorna:** {lost: boolean, cancelled?: true}

```js
await omni.crm.lose(881, { reason: 'Preco', obs: 'Fechou com o concorrente' });
```

## `tickets` — tickets

### `omni.tickets.list(filtros?)`

Lista os tickets visíveis ao usuário.

`read` · desde 1.0.0

**Parâmetros**

- `filtros` — `object`, opcional. Filtros aceitos pelo endpoint de tickets.

**Retorna:** Ticket[]

```js
const abertos = await omni.tickets.list({ status: 'aberto' });
```

### `omni.tickets.get(id)`

Devolve um ticket pelo id.

`read` · desde 1.0.0

**Parâmetros**

- `id` — `number`, obrigatório. Id do ticket.

**Retorna:** Ticket

```js
const ticket = await omni.tickets.get(4471);
```

### `omni.tickets.openForm(opts)`

Abre o formulário de ticket: com id edita, com prefill cria.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. Informe id para editar, ou prefill para criar já preenchido.

**Retorna:** {saved: boolean, id}

```js
const r = await omni.tickets.openForm({ prefill: { subject: 'Cobrança indevida' } });
```

## `tasks` — tarefas

### `omni.tasks.list(filtros?)`

Lista as tarefas visíveis ao usuário.

`read` · desde 1.0.0

**Parâmetros**

- `filtros` — `object`, opcional. Filtros aceitos pelo endpoint de tarefas.

**Retorna:** Task[]

```js
const minhas = await omni.tasks.list({ done: false });
```

### `omni.tasks.get(id)`

Devolve uma tarefa pelo id.

`read` · desde 1.0.0

**Parâmetros**

- `id` — `number`, obrigatório. Id da tarefa.

**Retorna:** Task

```js
const tarefa = await omni.tasks.get(302);
```

### `omni.tasks.openForm(opts)`

Abre o formulário de tarefa: com id edita, com prefill cria.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. Informe id para editar, ou prefill para criar já preenchida.

**Retorna:** {saved: boolean, id}

```js
await omni.tasks.openForm({ prefill: { title: 'Ligar para o cliente', contactId: 42 } });
```

## `queues` — filas

### `omni.queues.list()`

Lista as filas visíveis ao usuário da sessão.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** Queue[]

```js
const filas = await omni.queues.list();
```

## `users` — usuários

### `omni.users.list()`

Lista os usuários visíveis ao usuário da sessão.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** User[]

```js
const usuarios = await omni.users.list();
```

## `products` — produtos

### `omni.products.list(filtros?)`

Lista os produtos do catálogo. Product normalizado: {id, name, description, internalCode, gtin, value, price, recurrentValue, currency, measurementUnit, maxDiscount, maxRecurrentDiscount, groupIds, available, hiddenFromClients, imageUrl}. value e price sao o mesmo numero, na unidade da moeda; description vem truncada na carga de lista.

`read` · desde 1.0.0

**Parâmetros**

- `filtros` — `object`, opcional. groupId, com o id do grupo, e available, com true ou false. active e apelido de available. O filtro e local, sobre o catalogo ja carregado na sessao.

**Retorna:** Product[]

```js
const produtos = await omni.products.list({ groupId: 4, available: true });
```

### `omni.products.get(id)`

Devolve um produto pelo id.

`read` · desde 1.0.0

**Parâmetros**

- `id` — `number`, obrigatório. Id do produto.

**Retorna:** Product

```js
const produto = await omni.products.get(77);
```

### `omni.products.select(opts?)`

Abre o MESMO dialogo de escolha de produtos do carrinho das oportunidades e devolve o que o usuario escolheu; selected sai falso quando ele cancela.

`ui` · desde 1.1.0

**Parâmetros**

- `opts` — `object`, opcional. caption com o titulo do dialogo; selected com os ids ja marcados; e single, que limita a escolha a um produto.

**Retorna:** {selected: boolean, products: Product[], ids: number[]}

```js
const r = await omni.products.select({ caption: 'Itens do pedido' });
if (r.selected) { r.products.forEach(p => console.log(p.name, p.value)); }
```

## `cart`

### `omni.cart.get(opts?)`

Devolve o carrinho sincronizado do atendimento. Cart normalizado: {available, chatId, queueId, opportunityId, cartSession, version, locked, canConvert, stageId, readOnly, lines, totals}. Cada linha e {productId, internalCode, name, imageUrl, qty, unitPrice, discount, lineTotal, recurrentUnitPrice, recurrentDiscount} e totals e {subtotal, discount, freight, total, recurrentTotal, itemCount, lineCount}. As chaves saem sempre; available sai falso quando nao ha atendimento aberto ou quando a fila dele nao tem carrinho sincronizado, e ai lines vem vazia e totals zerado. E a unica leitura de carrinho que nao recusa: perguntar o que ha no carrinho tem resposta mesmo onde nao existe carrinho. Dinheiro na unidade da moeda, nunca em centavos.

`read` · desde 1.2.0

**Parâmetros**

- `opts` — `object`, opcional. chatId, para ler o carrinho de outro atendimento visivel a esta sessao; OMITIDO usa o atendimento aberto na tela. Informado e ilegivel (0, nulo, texto) e recusado com bad_args, nunca cai no atendimento aberto. Informado e nao visivel devolve available falso.

**Retorna:** Cart

```js
const carrinho = await omni.cart.get();
if (!carrinho.available) { return; }
console.log(carrinho.totals.total, carrinho.lines.length);
```

### `omni.cart.add(productId, opts?)`

Acrescenta um produto ao carrinho, somando a quantidade a que ja estiver la. O carrinho e criado na primeira operacao de escrita, se ainda nao existir. A chamada devolve ok mesmo com recusa parcial: rejected lista o que o servidor nao aceitou, cada entrada com reason (invalid_product, unknown_product, product_unavailable, product_not_in_queue, invalid_qty) e op, a operacao recusada na mesma forma publica que voce enviou. Conferir rejected e obrigatorio.

`write` · desde 1.2.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto. Precisa pertencer aos grupos de catalogo da fila; o servidor recusa qualquer outro.
- `opts` — `object`, opcional. qty com a quantidade a somar (padrao 1; zero tambem soma 1); discount e recurrentDiscount em percentual, limitados pelo teto do produto; chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.add(77, { qty: 2 });
```

### `omni.cart.setQuantity(productId, qty, opts?)`

Define a quantidade de uma linha do carrinho. Ao contrario de add, o valor e absoluto e nao incremental; zero (ou negativo) remove a linha. Quantidade acima de 100000 e reduzida ao teto, em silencio e sem entrar em rejected.

`write` · desde 1.2.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto ja presente no carrinho.
- `qty` — `number`, obrigatório. Quantidade final da linha. Zero remove a linha.
- `opts` — `object`, opcional. chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.setQuantity(77, 5);
```

### `omni.cart.remove(productId, opts?)`

Remove uma linha do carrinho. Num atendimento cujo carrinho ainda nao existe a chamada nao faz nada e nao abre oportunidade no funil.

`write` · desde 1.2.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto a remover.
- `opts` — `object`, opcional. chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.remove(77);
```

### `omni.cart.setDiscount(productId, opts)`

Concede desconto percentual numa linha do carrinho. E a mesma concessao que o agente faz pelo painel, com o mesmo teto por produto; o visitante nunca pode conceder desconto a si mesmo. Produto que ainda nao esta no carrinho e ACRESCENTADO com quantidade 1 ja com o desconto. ATENCAO A ESCALA: aqui o desconto e percentual (10 = dez por cento), mas maxDiscount de omni.products sai em centesimos de ponto percentual (1050 = 10,5 por cento).

`write` · desde 1.2.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto ja presente no carrinho.
- `opts` — `object`, obrigatório. discount em percentual sobre o preco a vista e recurrentDiscount em percentual sobre o preco recorrente; ambos limitados pelo teto cadastrado no produto. chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.setDiscount(77, { discount: 10 });
```

### `omni.cart.setSystemDiscount(productId, opts)`

Aplica o DESCONTO DO SISTEMA numa linha do carrinho: um desconto que o agente nao consegue alterar pela tela e que NAO e limitado pelo desconto maximo cadastrado no produto — aquele teto existe para conter a concessao do vendedor, e este desconto nao e concessao de vendedor. Ele SOMA com o desconto do agente, com teto de 100 por cento; use cart.setUserDiscountEnabled(productId, false) para zerar a parcela do agente e impedir a soma. E o caminho para refletir no carrinho a politica de preco de um sistema externo. Envie 0 para retirar o desconto.

`write` · desde 1.3.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto no carrinho.
- `opts` — `object`, obrigatório. systemDiscount em percentual sobre o preco a vista e systemRecurrentDiscount em percentual sobre o preco recorrente. triggerAutomation para a alteracao disparar a automacao de mudanca do carrinho da fila (padrao false). chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.setSystemDiscount(77, { systemDiscount: 12 });
await omni.cart.setUserDiscountEnabled(77, false);
```

### `omni.cart.setUserDiscountEnabled(productId, enabled, opts?)`

Bloqueia ou libera o desconto manual de um item. Bloquear ZERA o desconto que o agente ja tinha concedido naquela linha e impede novas alteracoes — e assim que se evita que o desconto do agente se some ao desconto do sistema. No painel do agente o botao de desconto some e da lugar a um cadeado.

`write` · desde 1.3.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto no carrinho.
- `enabled` — `boolean`, obrigatório. false bloqueia o desconto manual do item; true libera novamente.
- `opts` — `object`, opcional. triggerAutomation (padrao false) e chatId.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.setUserDiscountEnabled(77, false);
```

### `omni.cart.setNotes(productId, text, opts?)`

Escreve a observacao interna de uma linha do carrinho. Ela aparece SO no carrinho do atendente, nunca no catalogo do cliente, e serve para explicar de onde veio a condicao daquele item — o contrato que fixou o preco, a campanha que vale ate sexta. Nenhuma tela permite ao agente escrever ou apagar este texto.

`write` · desde 1.3.0

**Parâmetros**

- `productId` — `number`, obrigatório. Id do produto no carrinho.
- `text` — `string`, obrigatório. Observacao, ate 500 caracteres. Texto vazio limpa a observacao.
- `opts` — `object`, opcional. triggerAutomation (padrao false) e chatId.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.setNotes(77, 'Preço de tabela do contrato 4471');
```

### `omni.cart.clear(opts?)`

Esvazia o carrinho. O cliente ve a remocao na hora, na propria tela dele. Num atendimento cujo carrinho ainda nao existe a chamada nao faz nada e nao abre oportunidade no funil — vale para toda operacao que nao pode POR produto (clear, remove, setQuantity com zero e setFreight).

`write` · desde 1.2.0

**Parâmetros**

- `opts` — `object`, opcional. chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.clear();
```

### `omni.cart.mutate(ops, opts?)`

Aplica varias operacoes de uma vez. E o caminho certo para montar um carrinho inteiro a partir de um orcamento externo: uma requisicao, uma gravacao e um unico estado enviado ao cliente, em vez de uma ida por item.

`write` · desde 1.2.0

**Parâmetros**

- `ops` — `array`, obrigatório. Lista de operacoes aplicadas em ordem, numa unica ida ao servidor. Cada uma e {op, productId, qty, discount, recurrentDiscount}, com op em add, set, remove, discount ou clear. Uma operacao tambem aceita os campos privilegiados systemDiscount, systemRecurrentDiscount, disableUserDiscount e notes, que o painel do agente nao tem — ver cart.setSystemDiscount.
- `opts` — `object`, opcional. chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.mutate([
  { op: 'clear' },
  { op: 'add', productId: 77, qty: 2 },
  { op: 'add', productId: 81, qty: 1 },
  { op: 'discount', productId: 77, discount: 5 }
]);
```

### `omni.cart.setFreight(valor, opts?)`

Define o frete do carrinho. Entra no total e no valor da oportunidade, e o cliente ve na hora. Num atendimento cujo carrinho ainda nao existe a chamada nao faz nada e nao abre oportunidade no funil.

`write` · desde 1.2.0

**Parâmetros**

- `valor` — `number`, obrigatório. Frete na unidade da moeda (15.5 significa quinze reais e cinquenta centavos). Negativo vira zero.
- `opts` — `object`, opcional. chatId para operar outro atendimento.

**Retorna:** {ok: boolean, rejected: [], cart: Cart}

```js
await omni.cart.setFreight(15.5);
```

### `omni.cart.convert(opts?)`

Converte o carrinho em pedido: move a oportunidade para a etapa de pedido, executando as automacoes do funil, e so entao trava o carrinho e envia a mensagem de pedido, se a fila estiver configurada assim. Um carrinho novo e vazio nasce no lugar. A movimentacao pode ser RECUSADA por uma automacao; nesse caso nada acontece e o erro traz errorCode com o motivo (move_refused, empty_cart, cart_locked, not_in_cart_stage, in_progress). O errorCode error e o unico desfecho ambiguo: a operacao falhou no meio e pode ter sido parcialmente aplicada, entao releia com cart.get antes de tentar de novo. Como chamador automatico, a extensao respeita o teto de 10 conversoes por minuto por atendimento: estourado, o errorCode e rate_limited.

`write` · desde 1.2.0

**Parâmetros**

- `opts` — `object`, opcional. chatId para operar outro atendimento.

**Retorna:** {converted: boolean, opportunityId: number, replacementId: number}. O estado do carrinho e relido antes de responder, entao um cart.get logo depois ja devolve o carrinho NOVO e vazio, e nao o pedido que acabou de fechar.

```js
try {
  const r = await omni.cart.convert();
  await omni.ui.toast('Pedido ' + r.opportunityId + ' fechado.', 'success');
} catch (e) {
  if (e.errorCode === 'move_refused') { await omni.ui.toast('O funil recusou a movimentacao.', 'warn'); }
}
```

### `omni.cart.sendCartMessage(opts?)`

Envia ao cliente a mensagem com o botao que abre o carrinho dele. Atalho de navegacao: nao altera o carrinho nem fecha pedido. Exige carrinho ja criado e fila que entregue catalogo ao cliente; sem isso o erro traz errorCode no_cart ou no_catalog.

`write` · desde 1.2.0

**Parâmetros**

- `opts` — `object`, opcional. bodyText com o corpo da mensagem (ate 1024 caracteres) e buttonText com o rotulo do botao (ate 20); omitidos usam os textos padrao traduzidos. chatId para operar outro atendimento.

**Retorna:** {sent: boolean, messageId: number}

```js
await omni.cart.sendCartMessage({ bodyText: 'Seu orcamento esta pronto:' });
```

### `omni.cart.listOrders(opts?)`

Lista os pedidos anteriores do MESMO cliente no funil de carrinho da fila. CartOrder normalizado: {opportunityId, createdAt, closedAt, status, stageId, stageName, stageColor, locked, lineCount, total, recurrentTotal}. So entra o carrinho que de fato virou pedido; o carrinho abandonado na etapa de carrinho fica de fora. Dinheiro na unidade da moeda.

`read` · desde 1.2.0

**Parâmetros**

- `opts` — `object`, opcional. limit com o numero maximo de pedidos (padrao 20, teto 50) e chatId para consultar outro atendimento.

**Retorna:** CartOrder[]

```js
const pedidos = await omni.cart.listOrders({ limit: 10 });
```

### `omni.cart.getOrder(opportunityId, opts?)`

Devolve os itens de UM pedido do historico, no mesmo formato do carrinho vivo e com readOnly verdadeiro. Os precos sao os congelados no fechamento nas filas que travam o carrinho ao converter; sem esse travamento o pedido guarda o preco gravado na linha. O campo locked da listagem diz qual dos dois casos e.

`read` · desde 1.2.0

**Parâmetros**

- `opportunityId` — `number`, obrigatório. Id do pedido, vindo de cart.listOrders. O servidor reconfere que ele pertence ao historico deste cliente.
- `opts` — `object`, opcional. chatId para consultar outro atendimento.

**Retorna:** Cart

```js
const pedido = await omni.cart.getOrder(9931);
```

### `omni.cart.listAllowedProducts(opts?)`

Lista os produtos que ESTA fila entrega ao cliente, no mesmo formato de omni.products.list. E o conjunto que o carrinho aceita: pertencer aos grupos de catalogo da fila E estar vendavel (nao arquivado, disponivel, nao oculto para clientes). Qualquer outro e recusado pelo servidor com product_not_in_queue ou product_unavailable. Fila sem grupo de catalogo configurado devolve lista VAZIA, e isso e literal: naquela fila nenhum produto entra no carrinho, e a lista vazia e sinal de configuracao incompleta. Le o catalogo ja carregado na sessao: chamada antes de o catalogo terminar de carregar pode devolver menos itens.

`read` · desde 1.2.0

**Parâmetros**

- `opts` — `object`, opcional. chatId para consultar outro atendimento.

**Retorna:** Product[]

```js
const permitidos = await omni.cart.listAllowedProducts();
const r = await omni.products.select({ caption: 'Itens', selected: [] });
```

### `omni.cart.attach(opts)`

Anexa ao carrinho um arquivo que JA esta neste atendimento: um anexo do proprio carrinho ou a midia de uma mensagem da conversa. Um fileId de fora do atendimento e recusado com file_not_available, e essa recusa e a regra e nao uma limitacao a contornar. Informe productId para vincular o anexo a um item (e assim que a receita fica ligada ao medicamento); omita para anexar ao pedido inteiro. A fila decide o que e aceito: ela pode aceitar anexo so por produto, so no carrinho, ou somente nos produtos que exigem receita. Veja attachConfig em cart.get.

`write` · desde 1.3.0

**Parâmetros**

- `opts` — `object`, obrigatório. fileId do arquivo a anexar; productId para prender o anexo a um item do carrinho; chatId para operar outro atendimento.

**Retorna:** {ok, rejected, cart}

```js
await omni.cart.attach({ fileId: 8821, productId: 143 });
```

### `omni.cart.detach(opts)`

Remove o vinculo de um anexo com o carrinho. O ARQUIVO continua existindo na conversa: sai apenas o vinculo. Informe o mesmo productId com que ele foi anexado, porque o mesmo arquivo pode estar preso a mais de um item e a nenhum deles ao mesmo tempo.

`write` · desde 1.3.0

**Parâmetros**

- `opts` — `object`, obrigatório. fileId do anexo; productId a que ele esta preso (omita para o anexo do carrinho); chatId para operar outro atendimento.

**Retorna:** {ok, rejected, cart}

```js
await omni.cart.detach({ fileId: 8821, productId: 143 });
```

### `omni.cart.listAttachments(opts?)`

Lista os anexos do carrinho sem puxar o carrinho inteiro. Cada anexo traz fileId, productId (0 = anexo do pedido), productName, name, mimetype e size. attachConfig diz o que a fila permite. missingPrescription traz os produtos que exigem receita e ainda nao tem arquivo anexado; requirePrescription diz se a fila impede a interface padrao de fechar o pedido nessa situacao. A extensao NAO e impedida: cart.convert continua fechando, e a lista esta aqui para que ela possa avisar.

`read` · desde 1.3.0

**Parâmetros**

- `opts` — `object`, opcional. chatId para consultar outro atendimento.

**Retorna:** {attachments, attachConfig, requirePrescription, missingPrescription}

```js
const {attachments, missingPrescription} = await omni.cart.listAttachments();
```

## `forms` — formulários personalizados

### `omni.forms.list()`

Lista os formulários personalizados da instância.

`read` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {id, name, description, fields[]}[]

```js
const formularios = await omni.forms.list();
```

### `omni.forms.open(formId, opts?)`

Abre um formulário personalizado: com onSubmit igual a return a automação configurada NÃO roda e os dados voltam para a extensão; com automation a automação roda normalmente.

`ui` · desde 1.0.0

**Parâmetros**

- `formId` — `number`, obrigatório. Id do formulário.
- `opts` — `object`, opcional. prefill com os campos já preenchidos e onSubmit, que aceita automation, o padrão, ou return.

**Retorna:** Com onSubmit igual a return: {submitted, data}; com automation: {submitted}

```js
const r = await omni.forms.open(7, { onSubmit: 'return', prefill: { cpf: '00000000000' } });
if (r.submitted) { enviarAoErp(r.data); }
```

### `omni.forms.openDynamic(formulario, opts?)`

Abre um formulario montado pela propria extensao em tempo de execucao, sem precisar cadastra-lo antes; as respostas voltam para a extensao e nenhuma automacao roda.

`ui` · desde 1.1.0

**Parâmetros**

- `formulario` — `object`, obrigatório. O formulario inteiro, montado pela extensao: name, description opcional e fields, onde cada campo tem id, label e type. Tipos de entrada: 1 texto, 2 area de texto, 3 inteiro, 4 decimal, 5 telefone, 6 e-mail, 7 data, 9 data e hora, 10 lista (usa options), 12 caixa de marcacao, 13 telefone internacional. Tipos de exibicao: 20 titulo e 21 texto usam content (o label ali e so um nome interno), 22 imagem usa content com a URL, 23 separador, 24 quebra de linha. TODO campo precisa de id, label e type, inclusive os de exibicao, e os ids precisam ser unicos. Cada campo aceita ainda required, lock, options, width de 1 a 12, newRow, helpText, align, imageWidth e imageHeight. A imagem do tipo 22 precisa ser um arquivo da propria extensao ou um data: URI.
- `opts` — `object`, opcional. prefill com as respostas ja preenchidas, por id de campo, e submitLabel com o texto do botao de envio.

**Retorna:** {submitted: boolean, data}

```js
const r = await omni.forms.openDynamic({
  name: 'Segunda via',
  description: 'Confirme os dados antes de emitir.',
  fields: [
    { id: 'competencia', label: 'Competencia', type: 10, required: true, options: ['01/2026', '02/2026'] },
    { id: 'email', label: 'Enviar para', type: 6, required: true, width: 8 },
    { id: 'urgente', label: 'Emitir com prioridade', type: 12 }
  ]
}, { submitLabel: 'Emitir' });
if (r.submitted) { emitir(r.data.competencia, r.data.email); }
```

## `ui` — interface da aplicação

### `omni.ui.toast(msg, tipo?)`

Mostra uma notificação curta na interface da aplicação.

`ui` · desde 1.0.0

**Parâmetros**

- `msg` — `string`, obrigatório. Texto da notificação.
- `tipo` — `string`, opcional. success, info, warn ou error; o padrão é info.

**Retorna:** {shown: true}

```js
await omni.ui.toast('Título baixado.', 'success');
```

### `omni.ui.confirm(opts)`

Abre um diálogo de confirmação da aplicação e devolve a escolha do usuário.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. title, message, okLabel e cancelLabel; apenas message é obrigatório.

**Retorna:** {confirmed: boolean}

```js
const r = await omni.ui.confirm({ title: 'Cancelar título', message: 'Confirma?' });
if (r.confirmed) { cancelar(); }
```

### `omni.ui.alert(opts)`

Abre um diálogo de aviso da aplicação, com um único botão.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. title, message e okLabel; apenas message é obrigatório.

**Retorna:** {closed: true}

```js
await omni.ui.alert({ title: 'ERP indisponível', message: 'Tente de novo em instantes.' });
```

### `omni.ui.loading(bool)`

Liga e desliga o indicador de carregamento global da aplicação; desligue sempre no finally.

`ui` · desde 1.0.0

**Parâmetros**

- `bool` — `boolean`, obrigatório. true liga o indicador, false desliga.

**Retorna:** {loading: boolean}

```js
await omni.ui.loading(true);
try { await carregar(); } finally { await omni.ui.loading(false); }
```

### `omni.ui.openContribution(contributionId, params?)`

Abre outra contribuição desta mesma extensão, na apresentação declarada no manifest.

`ui` · desde 1.0.0

**Parâmetros**

- `contributionId` — `string`, obrigatório. Id da contribuição declarada no manifest desta extensão.
- `params` — `object`, opcional. Parâmetros entregues à contribuição no handshake.

**Retorna:** {opened: boolean}

```js
await omni.ui.openContribution('consulta', { contatoId: 42 });
```

### `omni.ui.openHtml(opts)`

Abre um HTML da própria extensão num diálogo ou em tela cheia; URL fora da extensão é recusada com forbidden.

`ui` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. url, presentation com mode e size, size e title; a url precisa apontar para dentro da própria extensão.

**Retorna:** {opened: boolean}

```js
await omni.ui.openHtml({ url: 'detalhe.html', presentation: { mode: 'dialog', size: 'lg' } });
```

### `omni.ui.openEmbed(opts)`

Abre uma página de OUTRO site (painel do Looker Studio, Power BI, Metabase) num diálogo do sistema, fora do iframe da extensão; a origem da URL precisa estar em embedOrigins no manifest, e o diálogo mostra ao usuário de qual site vem o conteúdo. URL de origem não declarada é recusada com forbidden, e URL malformada ou sem https com bad_args. A página externa não recebe o SDK e não conversa com a extensão. Cada instalação mantém no máximo 3 páginas externas abertas ao mesmo tempo; além disso a chamada devolve opened falso, sem erro.

`ui` · desde 1.4.0

**Parâmetros**

- `opts` — `object`, obrigatório. url (https, com a origem declarada em embedOrigins no manifest), size (sm, md, lg, xl ou full), presentation com mode dialog ou fullscreen (fullscreen abre o maior diálogo) e title.

**Retorna:** {opened: boolean}

```js
const contato = await omni.contacts.get(contatoId);
await omni.ui.openEmbed({
  url: 'https://lookerstudio.google.com/embed/reporting/SEU_RELATORIO/page/p_1?params=' +
    encodeURIComponent(JSON.stringify({ 'ds0.cliente': contato.id })),
  size: 'xl',
  title: 'Histórico do cliente'
});
```

### `omni.ui.resize(altura)`

Pede ao host que ajuste a altura do container da contribuição; é ignorado, sem erro, nos slots de altura fixa.

`ui` · desde 1.0.0

**Parâmetros**

- `altura` — `number`, obrigatório. Altura desejada, em pixels.

**Retorna:** {applied: boolean}

```js
const ro = new ResizeObserver(() => omni.ui.resize(document.body.scrollHeight));
ro.observe(document.body);
```

### `omni.ui.close()`

Fecha o diálogo ou a tela cheia que contém esta contribuição; não tem efeito num painel fixo.

`ui` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {closed: boolean}

```js
document.getElementById('fechar').onclick = () => omni.ui.close();
```

## `chatPanel` — painel lateral do atendimento

### `omni.chatPanel.get()`

Estado do painel lateral do atendimento: se ele existe nesta tela, se esta aberto, qual aba mostra e o que cada aba tem para oferecer. available sai falso fora da tela de atendimento.

`read` · desde 1.1.0

**Parâmetros:** nenhum.

**Retorna:** {available, visible, view, views[], extensions[], extensionKey, sessionId, sessions[], opportunityId, opportunities[], contactId}

```js
const p = await omni.chatPanel.get();
if (p.available && !p.visible) { await omni.chatPanel.show(); }
```

### `omni.chatPanel.show(opts?)`

Abre o painel lateral do atendimento, opcionalmente ja selecionando o que exibir.

`ui` · desde 1.1.0

**Parâmetros**

- `opts` — `object`, opcional. Mesmos campos de chatPanel.select. Omitido, abre o painel na aba que ja estava escolhida.

**Retorna:** {visible: true, view}

```js
await omni.chatPanel.show({ view: 'extension' });
```

### `omni.chatPanel.hide()`

Fecha o painel lateral do atendimento. ATENCAO: se a sua contribuicao esta montada nele, ela e desmontada e recebe destroy.

`ui` · desde 1.1.0

**Parâmetros:** nenhum.

**Retorna:** {visible: false}

```js
document.getElementById('fechar').onclick = () => omni.chatPanel.hide();
```

### `omni.chatPanel.select(opts)`

Troca o que o painel lateral exibe, sem abrir nem fechar. Uma aba indisponivel no atendimento atual e recusada com not_found.

`ui` · desde 1.1.0

**Parâmetros**

- `opts` — `object`, obrigatório. view com extension, cards, opportunities ou contact. Com extension, contributionId escolhe qual painel SEU exibir quando a extensao tem mais de um. Com cards, sessionId escolhe a sessao. Com opportunities, opportunityId escolhe a oportunidade.

**Retorna:** {view, extensionKey, sessionId, opportunityId}

```js
await omni.chatPanel.select({ view: 'opportunities', opportunityId: 881 });
```

## `data` — API REST da instância

### `omni.data.request(recurso, verbo, payload?)`

Chama um endpoint REST da instância com o JWT da sessão; o recurso é uma chave da allowlist e nunca uma URL, chave desconhecida devolve bad_args, a permissão continua sendo a do endpoint no servidor e o host trata GET como leitura e os demais verbos como escrita.

`read` · desde 1.0.0

**Parâmetros**

- `recurso` — `string`, obrigatório. Chave da allowlist de recursos, opcionalmente com sufixo de id e query string; não é uma URL.
- `verbo` — `string`, obrigatório. GET, POST, PUT, PATCH ou DELETE.
- `payload` — `object`, opcional. Corpo da requisição, nos verbos que aceitam corpo.

**Retorna:** A resposta do endpoint REST

```js
const contato = await omni.data.request('contacts/123', 'GET');
await omni.data.request('tasks', 'POST', { title: 'Ligar para o cliente', contact: 123 });
```

## `http` — chamadas para fora

### `omni.http.request(opts)`

Faz uma requisição HTTP para fora, executada no BACKEND da instância — é o caminho para falar com a API do parceiro, já que um iframe de origem opaca envia Origin nulo e seria recusado; aceita apenas http e https, bloqueia destinos privados e de loopback, limita a resposta a 5 MB e aplica 30 requisições por minuto por instalação e usuário.

`write` · desde 1.0.0

**Parâmetros**

- `opts` — `object`, obrigatório. url, method com padrão GET, headers, body, timeout com padrão 30000 e responseType com padrão text.

**Retorna:** {status, headers, body}

```js
const r = await omni.http.request({
  url: 'https://erp.acme.com.br/titulos?cpf=' + cpf,
  headers: { Authorization: 'Bearer ' + token }
});
const titulos = JSON.parse(r.body);
```

## `storage` — persistência por usuário e dispositivo

### `omni.storage.get(key)`

Lê um valor persistente da extensão; a leitura é síncrona contra o snapshot do handshake e nunca vai à rede.

`local` · desde 1.0.0

**Parâmetros**

- `key` — `string`, obrigatório. Chave, sem prefixo — o namespace é aplicado pelo host.

**Retorna:** O valor gravado, ou null

```js
const filtro = (await omni.storage.get('ultimoFiltro')) || { status: 'aberto' };
```

### `omni.storage.set(key, value)`

Grava um valor persistente da extensão, por usuário e dispositivo; a escrita é otimista, e o espelho local é desfeito se o host recusar por cota.

`write` · desde 1.0.0

**Parâmetros**

- `key` — `string`, obrigatório. Chave, sem prefixo.
- `value` — `any`, obrigatório. Valor serializável em JSON.

**Retorna:** {key, value}

```js
await omni.storage.set('ultimoFiltro', { status: 'aberto', pagina: 1 });
```

### `omni.storage.remove(key)`

Remove um valor persistente da extensão; remover chave inexistente é sucesso, não erro.

`write` · desde 1.0.0

**Parâmetros**

- `key` — `string`, obrigatório. Chave, sem prefixo.

**Retorna:** {key, removed: true}

```js
await omni.storage.remove('ultimoFiltro');
```

### `omni.storage.keys()`

Lista as chaves persistentes desta extensão para o usuário e o dispositivo atuais.

`local` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** string[]

```js
for (const k of await omni.storage.keys()) { console.log(k); }
```

### `omni.storage.clear()`

Apaga todos os valores persistentes desta instalação para o usuário e o dispositivo atuais, sem afetar outras instalações nem outros usuários.

`write` · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** {cleared: true}

```js
await omni.storage.clear();
```

## `state` — memória compartilhada da aba

### `omni.state.get(key?)`

Lê o estado compartilhado da aba, que vive na memória do navegador, é compartilhado por todos os iframes da mesma instalação na mesma aba e some ao recarregar a página.

`local` · desde 1.0.0

**Parâmetros**

- `key` — `string`, opcional. Chave a ler; omitida, devolve o estado completo.

**Retorna:** O valor da chave, ou o objeto de estado inteiro

```js
const aba = await omni.state.get('abaAtiva');
```

### `omni.state.set(key, value)`

Grava no estado compartilhado da aba e propaga a mudança para os demais iframes da mesma instalação.

`local` · desde 1.0.0

**Parâmetros**

- `key` — `string`, obrigatório. Chave.
- `value` — `any`, obrigatório. Valor serializável.

**Retorna:** {key, value}

```js
await omni.state.set('clienteSelecionado', { id: 42 });
```

### `omni.state.on(evento, cb)`

Assina as mudanças do estado compartilhado da aba.

`local` · desde 1.0.0

**Parâmetros**

- `evento` — `string`, obrigatório. Único valor aceito: change.
- `cb` — `function`, obrigatório. Recebe a chave, o valor novo e o estado completo.

**Retorna:** Função de cancelamento

```js
omni.state.on('change', (key, value) => {
  if (key === 'clienteSelecionado') { recarregar(value.id); }
});
```

## `bus` — barramento local da instalação

### `omni.bus.emit(evento, payload?)`

Emite um evento no barramento local da instalação, que chega aos assinantes deste iframe e aos dos demais iframes da mesma instalação na mesma aba, sem atravessar usuários nem abas.

`local` · desde 1.0.0

**Parâmetros**

- `evento` — `string`, obrigatório. Nome livre, escolhido pela extensão.
- `payload` — `any`, opcional. Carga serializável.

**Retorna:** {emitted: true}

```js
await omni.bus.emit('recarregarTitulos', { contatoId: 42 });
```

### `omni.bus.on(evento, cb)`

Assina um evento do barramento local da instalação.

`local` · desde 1.0.0

**Parâmetros**

- `evento` — `string`, obrigatório. Nome do evento.
- `cb` — `function`, obrigatório. Recebe o payload.

**Retorna:** Função de cancelamento

```js
omni.bus.on('recarregarTitulos', ({ contatoId }) => carregar(contatoId));
```

### `omni.bus.off(evento, cb?)`

Cancela a assinatura de um evento do barramento local.

`local` · desde 1.0.0

**Parâmetros**

- `evento` — `string`, obrigatório. Nome do evento.
- `cb` — `function`, opcional. Callback específico; omitido, remove todos.

**Retorna:** void

```js
omni.bus.off('recarregarTitulos');
```

## `channel` — mensagens entre usuários

### `omni.channel.publish(topic, payload, destino)`

Publica uma mensagem no canal da instalação, entregue às telas dos usuários alvo na mesma instância; é um relay de melhor esforço, sem retenção, ordenação, replay ou confirmação, limitado a 4 KB por mensagem e a 10 mensagens por segundo por usuário — publique sempre identificadores, nunca dados, porque quem recebe busca o dado com a própria permissão.

`write` · desde 1.0.0

**Parâmetros**

- `topic` — `string`, obrigatório. Tópico livre, namespaceado pelo servidor por instalação.
- `payload` — `any`, obrigatório. Carga serializável, de até 4 KB.
- `destino` — `object`, obrigatório. Objeto com to, aceitando user com id, users com lista de ids, type com agent, supervisor ou admin, queue com id, group com id, ou all; omitir o alvo é erro, porque all nunca é o padrão.

**Retorna:** {published: true}

```js
await omni.channel.publish('titulo-pago', { id: 4471 }, { to: 'queue:12' });
```

### `omni.channel.subscribe(topic, cb)`

Assina um tópico do canal da instalação; quem assina depois de uma publicação perdeu a mensagem, então busque estado fresco ao montar.

`local` · desde 1.0.0

**Parâmetros**

- `topic` — `string`, obrigatório. Tópico.
- `cb` — `function`, obrigatório. Recebe o payload e o meta, com from e at.

**Retorna:** Função de cancelamento

```js
omni.channel.subscribe('titulo-pago', async ({ id }) => {
  const titulo = await omni.data.request('opportunities/' + id, 'GET');
  atualizar(titulo);
});
```

### `omni.channel.unsubscribe(topic, cb?)`

Cancela a assinatura de um tópico do canal.

`local` · desde 1.0.0

**Parâmetros**

- `topic` — `string`, obrigatório. Tópico.
- `cb` — `function`, opcional. Callback específico; omitido, remove todos os callbacks do tópico.

**Retorna:** void

```js
omni.channel.unsubscribe('titulo-pago');
```

## `handlers` — registro de handlers no worker

### `omni.handlers.register(nome, fn)`

Registra uma função chamada quando o host despachar a contribuição de código correspondente; só existe no worker, e atribuir direto ao objeto handlers não funciona.

`local` · **worker** · desde 1.0.0

**Parâmetros**

- `nome` — `string`, obrigatório. Nome do handler, igual ao campo handler do manifest.
- `fn` — `function`, obrigatório. Recebe o contexto do item clicado e a contribuição que originou a chamada; pode devolver Promise.

**Retorna:** boolean, indicando se o registro foi aceito

```js
omni.handlers.register('segundaVia', async (ctx) => {
  const contato = await omni.contacts.get(ctx.contactId);
  await omni.ui.toast('Segunda via enviada para ' + contato.email, 'success');
  return { ok: true };
});
```

### `omni.handlers.list()`

Lista os nomes de handler registrados neste worker, útil para depurar manifest que declara um handler que o worker nunca registrou.

`local` · **worker** · desde 1.0.0

**Parâmetros:** nenhum.

**Retorna:** string[]

```js
console.log(await omni.handlers.list());
```

## `dev` — ferramentas da Bancada

### `omni.dev.snapshot(opts?)`

Captura a aparência atual do documento desta contribuição como PNG, rodando dentro do próprio iframe; só existe na Bancada, e a renderização é aproximada, não pixel a pixel.

`local` · **Bancada** · desde 1.0.0

**Parâmetros**

- `opts` — `object`, opcional. scale multiplica a resolução da captura, com padrão 1 e teto 3.

**Retorna:** {png, width, height, scale}

```js
if (typeof omni.dev?.snapshot === 'function') {
  const { png } = await omni.dev.snapshot({ scale: 2 });
  console.log('captura com ' + png.length + ' bytes');
}
```

### `omni.dev.log(opts?)`

Devolve o console e os erros capturados neste iframe, do mais antigo para o mais recente; só existe na Bancada.

`local` · **Bancada** · desde 1.0.0

**Parâmetros**

- `opts` — `object`, opcional. limit é quantas entradas devolver, da mais recente para trás, com padrão 200 e teto 500.

**Retorna:** {entries: []}

```js
const { entries } = await omni.dev.log({ limit: 50 });
console.table(entries.filter((e) => e.kind === 'error'));
```
