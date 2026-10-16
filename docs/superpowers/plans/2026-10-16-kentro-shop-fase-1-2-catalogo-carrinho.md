# Kentro Shop — Fase 1.2 (Sessões, carrinho, catálogo no celular e painel) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o atendente (ou a IA, na 1.4) gera um link exclusivo do atendimento. O cliente abre no celular um catálogo com os produtos ao vivo da loja, monta o carrinho e finaliza escolhendo entrega ou retirada. O atendente acompanha o carrinho ao vivo no painel da Kentro e recebe o resumo do pedido (handoff).

**Arquitetura:** a API guarda sessões, itens e eventos no Postgres. **O preço é sempre calculado no servidor**, revalidado ao vivo pelo `CatalogoService` (Fase 1.1) a cada alteração do carrinho e na finalização. O catálogo do cliente é um app Preact servido em `/c/:token`, que fala com rotas públicas autenticadas pelo token da sessão. O painel do atendente é o `painel.html` da extensão Atendimento, portado da demo. Um conector **"Demonstração"** (catálogo de exemplo da demo) permite testar o fluxo inteiro sem credenciais de e-commerce.

**Tecnologias:** as mesmas das fases anteriores. Para os testes do storefront: Jest + `jest-environment-jsdom` 29 renderizando os componentes Preact. A spec 15 pede Playwright, que fica para quando houver CI (ver Desvios).

**Spec:** `docs/superpowers/specs/2026-10-07-kentro-shop-design.md`: seções 8.2 (Atendimento e Catálogo), 9, 10.3 (sem edição do carrinho), 12 (`sessoes`, `itens_carrinho`, `eventos_sessao`, `configuracoes_loja`), 13 e 15.

**Referência funcional (portar o comportamento):**
- `shopping_dos_pisos/public/loja.js` (catálogo);
- `shopping_dos_pisos/extensao/index.html` (painel);
- `shopping_dos_pisos/src/sessoes/sessoes.service.ts` (resumo, eventos, validação da entrega).

## Restrições globais
- Sem commits. Português do Brasil. Erro padrão `{ erro: { codigo, mensagem } }`. Pacote único; `npm test` e `npm run build`.
- **Preço, total e frete só no servidor.** O navegador manda `produtoId`, `variacaoId` e `quantidade`, nunca preço.
- Toda consulta filtra por `loja_id`. A sessão é encontrada **pelo token**, e daí vem a loja; o token nunca é aceito de outra loja.
- Token do link: `randomBytes(24).toString('base64url')`, sem dados no link. Link expirado, inexistente ou de loja bloqueada → 404 `LINK_INVALIDO` ("Este link não está mais disponível. Peça um novo link no WhatsApp.").
- Rotas públicas do catálogo: limite de **120 requisições por minuto por IP**.
- Dados pessoais mínimos (nome, telefone, endereço de entrega) e nada disso em log.
- Limites: quantidade por item ≤ 999; até 100 itens por carrinho; textos com tamanho máximo (os da demo).
- O painel consulta a cada **5 s**, só com o painel visível e o pedido não finalizado (12/min, abaixo dos 30/min do `omni.http.request`).

## Desvios da spec decididos neste plano
1. **`configuracoes_loja` nasce aqui com valores padrão, só para leitura:**
   - entrega habilitada, retirada desabilitada, sem lojas de retirada;
   - frete `a_combinar`;
   - tema com o nome da loja e a cor `#7C3AED`;
   - expiração do link em 7 dias.

   A edição pela tela entra na 1.3.
2. **Conector `demonstracao`:** catálogo estático portado de `shopping_dos_pisos/src/catalogo/dados/catalogo.json`, credencial única `codigo = demo`, imagens vazias (o catálogo mostra um marcador com as iniciais). Ele aparece para todas as lojas como "Demonstração (dados de exemplo)".
3. **Testes do storefront com Jest + jsdom**, renderizando os componentes Preact, em vez de Playwright. A verificação visual em 390×844 é feita manualmente no Chrome na Tarefa 9.
4. **Frete na 1.2 só por regra da loja:** `a_combinar`, `fixo` ou `gratis_acima_de`. O `cotarFrete` da plataforma entra quando algum conector suportar.

## Foco de revisão
1. **Duas abas ou dois aparelhos com o mesmo link** → cada `PUT carrinho` substitui o carrinho inteiro; o cliente descarta respostas antigas (versão) e recarrega ao voltar para a aba (`visibilitychange`). Teste na Tarefa 6.
2. **Preço mudou ou produto sumiu entre a montagem e a finalização** → 409 `PRECOS_ALTERADOS` com as diferenças; o carrinho do servidor já vem atualizado; confirmar = finalizar de novo. Testes nas Tarefas 4 e 7.
3. **Quantidade acima do estoque** → limitada ao estoque, com aviso "Só temos N…". Teste na Tarefa 3.
4. **Plataforma fora do ar durante a montagem** → 502 com mensagem; o carrinho que já estava no servidor não se perde. Teste na Tarefa 3.
5. **Link do mesmo atendimento gerado de novo** → reaproveita a sessão aberta; depois de finalizada, cria outra. Teste na Tarefa 2.

---

## Estrutura de arquivos

```
api/prisma/migrations/*_sessoes/
api/src/
  config-loja/config-loja.service.ts   ConfigLojaService.obter(lojaId) (padrões + gravado)
  sessoes/calculo.ts                    totais, frete por regra, resumo, unidade, moeda (funções puras)
  sessoes/sessoes.service.ts            sessão, carrinho com revalidação, checkout, eventos
  sessoes/sessoes.controller.ts         rotas do atendimento (chave)
  sessoes/catalogo-publico.controller.ts rotas do cliente (token)
  sessoes/token-sessao.guard.ts         resolve a sessão pelo token
  sessoes/dto.ts  sessoes.module.ts
  conectores/demonstracao/demonstracao.conector.ts  dados.json
api/test/
  calculo.spec.ts  sessoes.e2e-spec.ts  carrinho.e2e-spec.ts  checkout.e2e-spec.ts  painel-sessao.spec.ts
  storefront/*.spec.tsx                 (componentes e lógica do catálogo)
storefront/src/
  main.tsx  api.ts  formato.ts  carrinho.ts (estado + sincronização)  app.tsx
  telas/Vitrine.tsx  Detalhe.tsx  Carrinho.tsx  Checkout.tsx  Confirmado.tsx  Diferencas.tsx  LinkInvalido.tsx
  estilo.css
extension/atendimento/painel.html
```

---

### Tarefa 1: Conector Demonstração e tabelas das sessões

**Arquivos:** `conectores/demonstracao/*`; registrar em `CONECTORES_PADRAO`; `prisma/schema.prisma` (+ migração `sessoes`); `config-loja/config-loja.service.ts`. Testes: entrada `demonstracao` em `contrato.spec.ts`; `migracoes.e2e-spec.ts`.

**Interfaces:**
- `conectorDemonstracao`:
  - campo de credencial `codigo` (texto, obrigatório, ajuda "Digite demo");
  - credencial válida só com `codigo === 'demo'`; com qualquer outro valor, `listarProdutos` lança `CredencialInvalida`;
  - capacidades: busca, categorias, variações, estoque, relacionados;
  - dados de `dados.json`, gerado a partir de `catalogo.json` da demo e já no modelo do Kentro Shop:
    - `id = sku`;
    - `imagens: []`;
    - `regras` **não** vêm do conector: o `m2PorUnidade` da demo vira uma regra sugerida, documentada no README do conector, para o admin cadastrar se quiser;
  - busca sem acento por nome, SKU e descrição curta;
  - paginação real.
- Prisma:

  | modelo | campos |
  |---|---|
  | `ConfigLoja` (`configuracoes_loja`) | `lojaId @id`; `tema Json`; `entrega Json`; `frete Json`; `lojasRetirada Json @default("[]")`; `modoPedido String @default("handoff")`; `expiracaoLinkDias Int @default(7)`; `categoriasOcultas String[]`; `urlCapturaKentro String?` |
  | `Sessao` (`sessoes`) | `id uuid`; `lojaId`; `token @unique`; `chatId`; `cliente Json`; `status` enum (`link_enviado`, `navegando`, `finalizado`, `pedido_criado`, `expirado`); `checkout Json?`; `totais Json`; `desconto Json?`; `abertaEm?`; `finalizadaEm?`; `expiraEm`; `criadaEm`; `atualizadaEm`; `@@index([lojaId, chatId])` |
  | `ItemCarrinho` (`itens_carrinho`) | `id`; `sessaoId`; `produtoId`; `variacaoId String?`; `sku`; `nome`; `variacaoNome?`; `imagem?`; `unidade`; `precoUnitario Decimal(12,2)`; `quantidade Int`; `m2 Float?`; `revalidadoEm`; `@@unique([sessaoId, produtoId, variacaoId])` |
  | `EventoSessao` (`eventos_sessao`) | `id`; `sessaoId`; `tipo`; `texto`; `autor` enum (`cliente`, `atendente`, `sistema`, `ia`); `em` |

  Todas com FK em cascata para `lojas` ou `sessoes`.
- `ConfigLojaService.obter(lojaId): Promise<ConfigEfetiva>`:
  - devolve os padrões do Desvio 1 mesclados com o que estiver gravado; não grava nada;
  - `ConfigEfetiva = { tema: { nome, corPrimaria, logoUrl?, boasVindas? }, entrega: { habilitada: boolean }, retirada: { habilitada: boolean }, lojasRetirada: LojaRetirada[], frete: { regra: 'a_combinar' | 'fixo' | 'gratis_acima_de'; valor?: number; minimo?: number; prazo?: string }, expiracaoLinkDias, modoPedido }`.

- [ ] Testes que falham:
  - o contrato roda para `demonstracao`;
  - `obter()` de loja sem linha devolve os padrões;
  - apagar a loja apaga as sessões.
- [ ] Implementar, gerar a migração, `npm test` passa.

### Tarefa 2: Cálculo, sessões e eventos

**Arquivos:** `sessoes/calculo.ts`, `sessoes/sessoes.service.ts` (sem carrinho ainda). Testes: `calculo.spec.ts`, `sessoes.e2e-spec.ts` (parte de serviço).

**Interfaces:**
- `calculo.ts`:
  - `arredondar(n)`;
  - `moeda(n)` (`pt-BR`, BRL);
  - `unidade(sigla, q)` (tabela da demo; sigla desconhecida → em minúsculas);
  - `calcularTotais(itens: {precoUnitario:number; quantidade:number}[], frete: number | null, desconto = 0): Totais`;
  - `freteDaRegra(regra, subtotal): { valor: number | null; titulo: string; prazo?: string }`:

    | regra | resultado |
    |---|---|
    | `a_combinar` | `{ valor: null, titulo: 'Frete a combinar' }` |
    | `fixo` | `valor` |
    | `gratis_acima_de` | `valor` abaixo do mínimo; 0 a partir dele |

  - `resumoDoPedido(sessao, itens, config): string`: o formato da demo, com "Frete: a combinar" quando o valor é `null`.
  - `Totais = { itens, subtotal, frete: number | null, desconto, total }`, onde `total` = subtotal − desconto + (frete ?? 0).
- `SessoesService`:
  - `criarOuReaproveitar(lojaId, { chatId, nome?, telefone? }): Promise<SessaoCompleta>`: reaproveita a sessão aberta (não finalizada nem expirada) do mesmo chat, atualizando nome e telefone quando vierem; senão cria uma nova com `expiraEm = agora + expiracaoLinkDias` e o evento "Link do catálogo gerado" (autor `atendente`);
  - `porToken(token): Promise<Sessao>`: lança `LINK_INVALIDO` se não existir, se estiver expirada (`expiraEm < agora` e não finalizada) ou se a loja estiver bloqueada;
  - `abrir(token)`: `link_enviado` → `navegando` + `abertaEm` + evento "Cliente abriu o catálogo";
  - `porChat(lojaId, chatId)`: a mais recente do chat, ou `null`;
  - `completa(sessao): SessaoCompleta`: `{ id, status, url, cliente, itens, totais, checkout, eventos (até 30, mais recente primeiro), resumo, abertaEm, finalizadaEm, expiraEm }`, com `url = urlPublica + '/c/' + token`.
- [ ] Testes que falham:
  - totais e as três regras de frete;
  - resumo de entrega, de retirada e com frete a combinar;
  - reaproveitar × criar nova depois de finalizar (Foco 5);
  - token expirado → `LINK_INVALIDO`;
  - token de loja bloqueada → `LINK_INVALIDO`;
  - `abrir` registra o evento só uma vez.
- [ ] Implementar e `npm test`.

### Tarefa 3: Carrinho com revalidação e rotas públicas do catálogo

**Arquivos:** `sessoes/token-sessao.guard.ts`, `sessoes/catalogo-publico.controller.ts`, métodos de carrinho no serviço. Teste: `carrinho.e2e-spec.ts`.

**Interfaces:**
- **Rotas públicas** (throttle 120/min por IP; `TokenSessaoGuard` põe `req.sessao` e `req.lojaId`):
  - `GET /v1/catalogo/:token/abrir` → `{ sessao: SessaoPublica, tema, entrega: { habilitada }, retirada: { habilitada, lojas }, frete: { regra, valor?, minimo?, prazo? } }`;
  - `GET /v1/catalogo/:token/categorias`, sem as `categoriasOcultas`;
  - `GET /v1/catalogo/:token/produtos?busca&categoria&pagina`;
  - `GET /v1/catalogo/:token/produtos/:id`;
  - `PUT /v1/catalogo/:token/carrinho` `{ itens: [{ produtoId, variacaoId?, quantidade }] }` → `{ sessao: SessaoPublica, avisos: string[] }`.

  `SessaoPublica` = `completa()` **sem** `eventos` nem `resumo`.
- **`definirCarrinho(token, itens)`:**
  - **agrupa e limita:** soma itens repetidos, limita a quantidade a 999 e ignora `quantidade ≤ 0`;
  - **revalida só o que mudou:** item novo ou com quantidade diferente é revalidado com `CatalogoService.obterProduto` (uma consulta por `produtoId` por requisição) e grava `precoUnitario`, `nome`, `imagem`, `unidade` e `m2 = quantidade × regras.m2PorUnidade`;
  - **itens descartados com aviso:**
    - produto ou variação que sumiu ou ficou indisponível → "Produto X não está mais disponível.";
    - quantidade acima do estoque → limitada, com "Só temos N {unidade} de X." (Foco 3);
  - **eventos:** "Adicionou", "Alterou" e "Removeu", como na demo;
  - **status:** `link_enviado` → `navegando`;
  - **sessão finalizada** → 409 `PEDIDO_JA_ENVIADO`.
- **Erros do conector** (plataforma fora do ar) → 502, sem alterar os itens gravados (Foco 4). A revalidação acontece antes de qualquer gravação, numa transação.

- [ ] Testes que falham (conector falso):
  - adicionar `A1` × 2 grava o preço do conector;
  - o navegador mandar `preco` é ignorado (400, por `forbidNonWhitelisted`);
  - variação inexistente é descartada com aviso;
  - estoque 5 com pedido de 9 → 5 e aviso;
  - plataforma indisponível → 502 e itens anteriores intactos;
  - sessão finalizada → 409;
  - link inválido → 404 `LINK_INVALIDO`;
  - categorias ocultas não aparecem;
  - rota de outra loja não atende o token (isolamento).
- [ ] Implementar e `npm test`.

### Tarefa 4: Finalização, frete e diferenças de preço

**Arquivos:** métodos `cotarFrete` e `finalizar` no serviço, rotas `POST /v1/catalogo/:token/frete` e `POST /v1/catalogo/:token/finalizar`. Teste: `checkout.e2e-spec.ts`.

**Interfaces:**
- `POST frete` com `{ cep }` (8 dígitos) → `{ titulo, valor: number | null, prazo? }`, pela regra da loja.
- `POST finalizar` com `FinalizarDto`:
  - corpo `{ tipo: 'entrega' | 'retirada'; entrega?: DadosEntrega; lojaRetiradaId?: string; observacoes?: string (≤ 500) }`;
  - `DadosEntrega` e a validação são os da demo, com mensagem "Preencha: CEP, Número.";
  - `tipo` desabilitado na loja → 400 "Esta loja não faz {entrega | retirada}.";
  - `lojaRetiradaId` inexistente → 400;
  - carrinho vazio → 400 "O carrinho está vazio.".
- **Revalidação total:** revalida **todos** os itens. Se mudar preço, estoque ou disponibilidade:
  - grava o carrinho atualizado;
  - devolve 409 `PRECOS_ALTERADOS` com `{ erro: {…}, diferencas: [{ sku, nome, antes: { preco, quantidade }, depois: { preco, quantidade } | null }], sessao }`.

  Quando nada mudou, finaliza:
  - grava `checkout` e `cliente` (nome e telefone da entrega);
  - `status: 'finalizado'` e `finalizadaEm`;
  - totais com o frete da regra;
  - evento "Cliente finalizou o pedido (entrega) — R$ …".

  Resposta: `SessaoPublica`.
- **O aviso para a Kentro (webhook)** entra na 1.4; aqui só um ponto de extensão `aoFinalizar` (lista vazia).
- [ ] Testes que falham:
  - finalizar com entrega válida;
  - CEP inválido;
  - retirada com a retirada desabilitada;
  - preço mudou no conector entre montar e finalizar → 409 com a diferença e, ao finalizar de novo, 200 (Foco 2);
  - produto sumiu → diferença com `depois: null`;
  - finalizar duas vezes → 409 `PEDIDO_JA_ENVIADO`;
  - frete `gratis_acima_de` aplicado no total.
- [ ] Implementar e `npm test`.

### Tarefa 5: Rotas do atendimento

**Arquivos:** `sessoes/sessoes.controller.ts`. Teste: `sessoes.e2e-spec.ts` (rotas).

**Interfaces:**
- Rotas (`@Papel('atendimento')`):
  - `POST /v1/sessoes` com `{ chatId (1..64), nome? (≤ 120), telefone? (≤ 30) }` → `SessaoCompleta`, status 201 quando cria e 200 quando reaproveita;
  - `GET /v1/sessoes/chat/:chatId` → `SessaoCompleta`, ou 404 `SEM_SESSAO`.
- `X-Kentro-Usuario-Nome` (decodificado) entra como autor dos eventos do atendente.
- [ ] Testes que falham:
  - criar e reaproveitar;
  - chave inválida → 401;
  - chat de outra loja não aparece;
  - a URL usa a `URL_PUBLICA`;
  - o resumo vem preenchido depois da finalização.
- [ ] Implementar e `npm test`.

### Tarefa 6: Storefront — base, API e estado do carrinho

**Arquivos:** `storefront/src/api.ts`, `formato.ts`, `carrinho.ts`; jest para TSX (`testEnvironment` jsdom por arquivo, `jsxImportSource: preact`). Testes: `api/test/storefront/formato.spec.ts` e `carrinho.spec.ts`.

**Interfaces:**
- `formato.ts`:
  - `brl(n)`;
  - `num(n)`;
  - `unidade(sigla, q)`;
  - `telefone('5538988887777')` → `'(38) 98888-7777'`;
  - `caixasParaArea(area, m2PorCaixa, perda: boolean)` = `ceil(area × (perda ? 1.1 : 1) / m2PorCaixa)`;
  - `quantidadeSugerida(m2Total, rendimentoM2)` = `max(1, ceil(m2Total / rendimentoM2))`;
  - `primeiroNome(nome)`.
- `api.ts`: `criarApi(token, fetchFn = fetch)` com:
  - `abrir`, `categorias`, `produtos(filtro)`, `produto(id)`, `salvarCarrinho(itens)`, `frete(cep)`, `finalizar(corpo)`;
  - erros como `{ status, codigo, mensagem, diferencas? }`.
- `carrinho.ts`: `criarCarrinho(api, aoMudar)` com:
  - `alterar(produtoId, variacaoId, quantidade)`: otimista, com debounce de 350 ms;
  - `sincronizarJa()`, `aplicar(sessao)`, `recarregar()` e `pendente`;
  - **versão:** resposta antiga é descartada (Foco 1);
  - `visibilitychange`: ao esconder com alteração pendente, envia na hora; ao voltar sem pendência, recarrega do servidor (`abrir`).
- [ ] Testes que falham:
  - formatos e calculadora (`área 10`, `1,44 m²/cx`, com perda → 8 caixas);
  - resposta fora de ordem descartada;
  - debounce junta 3 cliques num `PUT` só;
  - esconder a aba com alteração pendente envia na hora.
- [ ] Implementar e `npm test`.

### Tarefa 7: Storefront — telas

**Arquivos:** `storefront/src/app.tsx`, `telas/*.tsx`, `estilo.css` (portado de `loja.css`), `main.tsx`, `index.html`. Testes: `api/test/storefront/telas.spec.tsx`.

**Comportamento** (spec 9 e `loja.js`):
- **Topo:** faixa da marca rola com a página (logo, nome, "Olá, {primeiro nome}!"). Busca, botão do carrinho com contador e chips de categoria ficam fixos.
- **Busca:** com debounce de 400 ms, feita no servidor.
- **Vitrine:**
  - grade de 2 colunas, 24 por página, com rolagem infinita (`IntersectionObserver`);
  - card com imagem (ou marcador com as iniciais), selo, nome, preço "de/por", preço por m² (quando há `regras.m2PorUnidade`), "a partir de" (com variações) e "✓ N no carrinho".
- **Detalhe** (folha que sobe de baixo):
  - imagem; chips de variação; descrição;
  - estoque: "Últimas N" quando ≤ 10;
  - calculadora de m² (com `regras.m2PorUnidade`);
  - barra fixa com quantidade e "Adicionar";
  - "Compre junto": até 4 SKUs, carregados por `produto(sku)`, com quantidade sugerida pelo `rendimentoM2`.
- **Carrinho:** itens com +/−, remover e subtotal; "Continuar".
- **Checkout:**
  - entrega e/ou retirada, conforme a loja;
  - entrega com nome, telefone formatado, CEP com ViaCEP (preenche rua, bairro, cidade e UF; o `fetch` é injetável nos testes), número, complemento e referência;
  - retirada com cartões das lojas;
  - frete conforme a regra; observações;
  - "Enviar pedido para o atendente".
- **Diferenças de preço** (`PRECOS_ALTERADOS`): lista "antes → depois" e o botão "Confirmar e enviar".
- **Confirmação:** resumo e "Você já pode voltar para a conversa".
- **Avisos e cache:** avisos flutuantes no topo; `LinkInvalido` com "Este link não está mais disponível. Peça um novo link no WhatsApp."; assets com hash (Vite).
- **Tema:** `--cor-primaria` do tema da loja.

- [ ] Testes que falham (jsdom, `fetch` simulado):
  - carrega a vitrine e mostra a saudação;
  - adicionar pelo detalhe atualiza o contador e chama `PUT`;
  - a calculadora define a quantidade;
  - o checkout de entrega envia os campos e mostra a confirmação;
  - o 409 mostra as diferenças, e confirmar reenvia;
  - link inválido mostra a tela amigável;
  - a retirada desabilitada não aparece.
- [ ] Implementar, `npm test`, `npm run build`.

### Tarefa 8: Painel do atendente

**Arquivos:** `extension/atendimento/painel.html`. Teste: `api/test/painel-sessao.spec.ts`. O `omni-falso` ganha `chats.getSelected`, `contacts.get`, `on('omniChatSelected')` e `ui.toast`, todos controláveis.

**Comportamento** (demo `extensao/index.html`, com a API nova e o `api()` robusto da 1.1):
- **Telas:**
  - sem atendimento aberto → "Abra um atendimento…";
  - sem sessão (404 `SEM_SESSAO`) → "Gerar link do catálogo";
  - com sessão → status com 4 etapas, link e "Copiar", carrinho somente leitura (itens, totais, frete "a combinar"), atividade (8 eventos) e handoff com "Copiar resumo" quando finalizado.
- **Gerar link:** usa o nome e o telefone do contato (`omni.contacts.get`), chama `POST /v1/sessoes` e copia o link.
- **Atualização:** consulta a cada 5 s (pausa com a aba oculta ou com o pedido finalizado); troca de atendimento (`omniChatSelected`) zera o estado.
- **Aviso:** toast quando o cliente finaliza.
- **Chave de admin colada no painel:** continua recusada, como na 1.1.

- [ ] Testes que falham:
  - sem chat;
  - gerar link (corpo do `POST` com `chatId`, nome e telefone do contato);
  - sessão navegando mostra os itens;
  - finalizado mostra o handoff e para a consulta;
  - trocar de atendimento recarrega;
  - 404 mostra o botão de gerar.
- [ ] Implementar e `npm test`. Publicar a extensão Atendimento (clonar a v42) em **dev**.

### Tarefa 9: Verificação ponta a ponta e publicação

- [ ] `npm run build`; subir `node dist/main.js` com o banco local.
- [ ] **Roteiro com `curl`:**
  1. registrar a loja e integrar com `demonstracao` (`codigo: demo`) e testar;
  2. `POST /v1/sessoes`;
  3. abrir `/c/<token>` no Chrome em 390×844;
  4. adicionar 2 produtos (um com variação), finalizar com entrega;
  5. `GET /v1/sessoes/chat/…` mostra o resumo.
- [ ] Atualizar a spec (desvios 1 a 4; seção 12 com as colunas novas).
- [ ] **Usuário:** commit, push e deploy no Doca.
- [ ] Depois do deploy: mover o **prod** das duas extensões (Admin 0.1.1+ e Atendimento) e conferir na Kentro com a loja integrada ao conector Demonstração.

**Aceite da Fase 1.2:**
- o atendente gera o link no painel;
- o cliente abre no celular, busca, filtra, usa a calculadora e o compre junto, monta o carrinho e finaliza com entrega ou retirada;
- o painel mostra o carrinho ao vivo e o resumo;
- preço e estoque são revalidados na finalização.
