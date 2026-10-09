# Kentro Shop — Especificação de projeto

> **Para a IA que vai implementar:** leia o documento inteiro antes de escrever código. As decisões da seção 2 já foram tomadas com o dono do produto: não as reabra sem motivo concreto. Comece pela **Fase 0** (seção 16), que confirma as premissas marcadas com **⚠ VERIFICAR** (seção 17) antes do investimento grande. Há uma demo funcional que valida boa parte do fluxo; reaproveite-a (seção 19).

---

## 1. Contexto e objetivo

A **Kentro** (kentro.atenderbem.com, sistema "omni") é uma plataforma de atendimento omnichannel (WhatsApp, webchat etc.) com assistentes de IA, automações e **extensões** de terceiros. Uma extensão é instalada numa instância da Kentro colando a **URL de um `manifest.json`**.

O **Kentro Shop** é uma **extensão universal e multi-cliente** que transforma o atendimento em canal de venda para lojas que já têm um e-commerce:

1. A assistente de IA (ou o atendente) envia ao cliente um **link de catálogo** exclusivo daquele atendimento.
2. O cliente abre no celular um catálogo com cara de e-commerce, com os **produtos vindos ao vivo da plataforma de e-commerce da loja**. Ele monta o carrinho e finaliza escolhendo **entrega ou retirada**.
3. O atendente acompanha o **carrinho ao vivo** num painel lateral da Kentro e recebe o **resumo do pedido (handoff)**. Conforme a configuração da loja, o atendente pode criar o pedido no e-commerce com um clique.
4. A IA é avisada quando o cliente finaliza e conduz a confirmação e a transferência para um humano.

Qualquer loja instala sozinha, só com a URL do manifest, e configura tudo dentro da Kentro, sem depender do dono do produto.

**Critérios de sucesso do produto:**
- Uma loja nova instala e fica operando em menos de 15 minutos, sem ajuda.
- O catálogo é rápido e agradável no celular (4G).
- Adicionar uma plataforma de e-commerce nova não exige mexer no catálogo, na extensão nem nos outros conectores.
- Preço e estoque nunca são fechados desatualizados.

---

## 2. Decisões tomadas (não reabrir)

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Multi-cliente (SaaS)**: uma API serve várias lojas (tenants) | Instalar em grande demanda sem um deploy por cliente |
| D2 | **Cada loja se configura sozinha** na tela de Configurações da extensão (só administradores) | Escala sem trabalho manual por cliente |
| D3 | **Catálogo e carrinho próprios** do Kentro Shop. NÃO usar o catálogo/vitrine nativos da Kentro | Controle total da experiência; funciona em qualquer instância, sem depender de recursos habilitados |
| D4 | Conectores do MVP e ordem: **eCommerce-net → WooCommerce → Nuvemshop → Tray → Loja Integrada** | Escolha do dono do produto; eCommerce-net já tem cliente e documentação |
| D5 | Fechamento **configurável por loja**: modo `handoff` (atendente fecha a venda no e-commerce) ou `criar_pedido` (atendente clica e o Kentro Shop cria o pedido na plataforma). Nunca criar pedido sem ação humana | O humano valida estoque, prazo e pagamento |
| D6 | **Sem cobrança por enquanto**, mas o modelo de dados já tem plano, status e limites por loja | Monetizar depois sem refazer |
| D7 | **Proxy ao vivo**: o catálogo NÃO é copiado para o nosso banco. Cada listagem e busca consulta a API do e-commerce na hora | Escolha do dono do produto (sempre atualizado, menos peças). O que fica no nosso banco são **regras da loja** aplicadas por cima do produto (seção 7.4) |
| D8 | Conectores atrás de **uma interface única**; um cache poderá ser adicionado depois como camada (decorator), sem tocar em consumidores | Permitir evolução rápida |
| D9 | IA integrada por **servidor MCP** exposto pela API e por **um evento de finalização** via captura de webhook da Kentro | Mínimo de configuração por instância |
| D10 | Stack: **NestJS + Postgres (Prisma)** na API; **Vite + TypeScript + Preact** no catálogo; **HTML/JS puro** na extensão | A VPS de deploy já suporta NestJS; catálogo leve para celular; a extensão roda num iframe da Kentro |

---

## 3. Glossário

- **Loja / tenant**: um cliente do Kentro Shop. Uma loja = uma instalação da extensão numa instância da Kentro (uma instância pode instalar mais de uma vez, por exemplo produção e teste).
- **Conector**: código que traduz uma plataforma de e-commerce para o modelo do Kentro Shop.
- **Sessão do catálogo**: o carrinho de um atendimento (`chatId`), acessado pelo cliente via link com token.
- **Handoff**: entrega do pedido montado pelo cliente para o atendente humano finalizar.
- **Regras da loja**: dados que a loja cadastra por SKU e que a plataforma não tem (compre junto, m² por caixa, rendimento, selo, ocultar).

---

## 4. Arquitetura

```
Cliente (WhatsApp) ──link──▶ Catálogo mobile  /c/:token ─────────┐
                                                                  │
Kentro · atendente ── Extensão Kentro Shop ── omni.http.request ──┤
   • Painel do atendimento (chatPanel)                            │
   • Configurações (menu do topo, só admin)                       │
Kentro · assistente IA ── MCP (/mcp, Bearer) ─────────────────────┤
Kentro · captura de webhook ◀── evento "finalizado" ──────────────┤
                                                                  ▼
                              API Kentro Shop (NestJS, Postgres)
                              ├─ Lojas, plano, credenciais cifradas
                              ├─ Sessões, carrinhos, eventos, pedidos
                              ├─ Regras da loja por SKU
                              ├─ MCP server
                              └─ Conectores ──▶ eCommerce-net · WooCommerce ·
                                               Nuvemshop · Tray · Loja Integrada
```

### 4.1 Repositório (monorepo, npm workspaces)

npm workspaces em vez de pnpm (o pnpm não está instalado e a VPS usa `npm run build`). Situação após a Fase 0: existem `api/` (comum, saude, lojas, admin, arquivos-extensao, catalogo/página), `storefront/` (placeholder) e `extension/{atendimento,admin}`. As demais pastas abaixo entram nas fases que as usam; `packages/contratos` entra na Fase 1, com o modelo de produto.

```
kentro-shop/
  package.json    workspaces ["api", "storefront"]; build único
  scripts/copiar-build.mjs
  api/            NestJS (compila para ../dist)
    src/
      lojas/          registro, chaves, plano, superadmin
      integracoes/    credenciais, teste de conexão
      conectores/
        nucleo/       interface, registro, cliente HTTP comum, erros
        ecommercenet/ woocommerce/ nuvemshop/ tray/ lojaintegrada/
      catalogo/       serviço de catálogo (conector + regras da loja)
      sessoes/        sessões, carrinho, revalidação, eventos
      pedidos/        criar pedido via conector
      mcp/            servidor MCP
      kentro/         webhook de finalização
      config-loja/    tema, entrega, frete, modo de pedido, IA
      comum/          auth guards, criptografia, rate limit, logs
    prisma/schema.prisma
    test/
  storefront/     Vite + Preact — compilado para dist/public
  extension/      arquivos das extensões, servidos pela API (seção 4.3)
    atendimento/  manifest.json + painel.html
    admin/        manifest.json + config.html
  packages/
    contratos/    (Fase 1) tipos TypeScript compartilhados (modelo de produto, DTOs)
  docs/
```

**Build único:** `npm run build` na raiz gera um só `dist/` na raiz, como na demo: `dist/main.js` (API), `dist/public/` (storefront), `dist/extensao/{atendimento,admin}/` e `dist/prisma/` (schema e migrações). A VPS só leva a pasta `dist/` para o contêiner (lição da demo: arquivos fora de `dist/` dão 404 em produção). As dependências ficam no `node_modules` da raiz (workspaces). O `postinstall` da API roda `prisma generate`, e as migrações rodam no boot (`prisma migrate deploy`). Se faltar variável obrigatória, o boot para com a lista do que falta.

**Desenvolvimento local, sem Docker:** `npm run db:local` sobe um Postgres embutido (porta 54329) e `npm test` sobe outro, temporário, na porta 54330.

### 4.2 Deploy na VPS (um projeto)

| Campo | Valor |
|---|---|
| Tipo | API ou microsserviço (NestJS) |
| Pasta do projeto | **raiz do repositório** (o build precisa de `storefront/` e `extension/`) |
| Como construir | `npm run build` → `dist/main.js` |
| Porta / verificação | 3000 / `/` (configurável por `PORTA`) |
| Variáveis (aba "Variáveis") | `DATABASE_URL`, `CHAVE_MESTRA_CRIPTO` (base64 de 32 bytes; gerar uma vez e **nunca trocar**), `TOKEN_SUPERADMIN`, `URL_PUBLICA` |
| Banco | Postgres da VPS ligado ao projeto |

URLs das extensões para instalar na Kentro: `https://<domínio>/extensao/admin/manifest.json` e `https://<domínio>/extensao/atendimento/manifest.json`.

**Domínio com HTTPS é obrigatório em produção** (seção 13).

### 4.3 Extensão hospedada na VPS (decidido em 07/10/2026)
A extensão é servida pela VPS, não pela CDN da Kentro. **Implementado na Fase 0 pela própria API** (o antigo plano B virou o caminho principal, porque é testável e dispensa um segundo projeto): `GET /extensao/<atendimento|admin>/<arquivo>`. Requisitos atendidos, com teste automatizado:
- **`Access-Control-Allow-Origin: *` em todas as respostas**: no `manifest.json` e também nos HTML, JS e CSS. Sem o cabeçalho a instalação é recusada. Se ele faltar só nos arquivos, a falha é parcial: imagem e CSS carregam, mas `<script type="module">`, `import()`, `fetch` e `@font-face` quebram sem mensagem clara.
- `OPTIONS` (preflight) responde 204 com o mesmo cabeçalho, e cada arquivo sai com o `Content-Type` correto.
- O `manifest.json` é servido com `__URL_PUBLICA__` trocado pela `URL_PUBLICA`, então o campo `api_url` já vem preenchido na instalação.
- Só aceita nomes simples de arquivo (`[a-z0-9-]+.(html|json|js|css|svg|png)`): nada fora da pasta da extensão é alcançável.
- HTTPS com domínio próprio (configuração da VPS). Sem redirecionamento na URL do manifest, porque a Kentro não segue redirecionamento.
- **Versões e cache:** sem a CDN não há limite de 5 versões nem atraso de 15 min no ponteiro. Na Fase 0 tudo sai com `Cache-Control: no-cache`, porque os arquivos são pequenos. Cada deploy sobe a `version` do manifest; depois dele, rodar "Reconsultar manifest" na instalação (`extension_installs_refresh_manifest`). Pastas `v/<versão>/` com cache longo ficam para quando houver assets grandes.
- **Verificação:** `extension_installs_probe_manifest` com a URL da VPS precisa devolver `installable: true` antes de instalar.

---

## 5. O que se sabe da plataforma Kentro

Fatos verificados na demo (`shopping_dos_pisos`) com o MCP de configuração da Kentro.

### 5.1 Manifest de extensão (`manifestVersion: 1`)
- Chaves raiz: `manifestVersion, id, version, sdk, name, description, author, icon, requires, minHostVersion, worker, config, contributions, cartPricing, embedOrigins`. Obrigatórias: `manifestVersion, id, version, name, contributions`.
- `id`: `fornecedor.extensao` (minúsculas, números, hífen, exatamente um ponto). `version`: semver estrito, crescente.
- Tipos de contribuição de interface: `topMenu, topMenuSubItem, mainNav, chatMenu, chatPanel, msgMenu, cartAction, cartFooterAction, callAction`.
- `chatPanel`: painel lateral do atendimento, com apresentação fixa, exige `url` para um arquivo da versão.
- `topMenu`: modos `dialog | fullscreen | menu`; tamanhos de diálogo `sm | md | lg | xl | full`.
- `visibility`: `{ userTypes, userIds, queueIds, groupIds }`; `userTypes`: 0 administrador, 1 supervisor, 2 agente.
- `config` da instalação: tipos `string, number, boolean, url, secret, select`. `secret` é cifrado pela Kentro e nunca devolvido.
- A instalação **exige que o host do manifest devolva `Access-Control-Allow-Origin`**.

### 5.2 SDK no iframe (usado na demo)
- `omni.ready(cb)`: `cb(ctx)`, com `ctx.config` = valores da instalação.
- `omni.chats.getSelected()` → atendimento aberto (`id`, `contactId`, `contact { name, phone }`); evento `omni.on('omniChatSelected', cb)`.
- `omni.contacts.get(id)`.
- `omni.http.request({ url, method, headers, body })`: executado **no servidor da Kentro**, sem CORS. Limite **30 chamadas/min**. Erros: `{ code: 'http_error', status, body }`, `rate_limited`, `forbidden`, `timeout`.
- `omni.ui.toast(msg, tipo)`, `omni.ui.resize(alturaPx)`, `omni.ui.confirm({...})`, `omni.ui.openHtml({ url, title, presentation })`.
- Tokens de tema CSS publicados pela Kentro: `--ext-color-primary`, `--ext-color-bg`, `--ext-color-border`, `--ext-color-text`, `--ext-color-text-muted`, `--ext-color-error`, `--ext-color-success`, `--ext-radius`, `--ext-font-family`, `--ext-font-size`, `--ext-spacing` (declare fallbacks com `:where(:root)`).
- Imagens HTTP dentro da Kentro (HTTPS) são bloqueadas como conteúdo misto.

### 5.4 SDK — fatos confirmados na Fase 0 (referência oficial)
A referência completa do SDK, extraída da ajuda do editor de extensões da Kentro, está em [`docs/kentro/sdk-omni-referencia.md`](../../kentro/sdk-omni-referencia.md). Pontos que afetam o projeto:
- **Contexto do handshake** (`omni.ready(ctx)`): `ctx.user` = `{ id, name, type, email, queues[], groups[] }`, `ctx.user.permissions` = `{ isAdmin, isSupervisor, isSuperAdmin, ... }`, `ctx.config` (secrets já decifrados), `ctx.contribution` (`installId`, `id`, `type`, `params`), `ctx.instance` (`name`, `domain`). Também por `omni.session.getUser()` / `getPermissions()` / `getInstance()`.
- **`omni.storage` é por usuário e por dispositivo** (vive no navegador; cota de ~262 mil caracteres por instalação e usuário). A opção "Compartilhar armazenamento" da instalação só junta instalações da mesma extensão, **ainda dentro do espaço de cada usuário**. Não serve para guardar a chave da loja.
- `omni.data.request` só alcança uma lista fixa de recursos (contatos, oportunidades, filas, usuários, produtos etc.); **não** dá acesso à configuração da instalação.
- `omni.http.request`: 30 req/min **por instalação e por usuário**, resposta até 5 MB, timeout padrão 30 s; não acrescenta credencial da Kentro.
- Iframe com `sandbox` sem `allow-same-origin`: `fetch` direto sai com `Origin: null`; `localStorage` é um substituto do SDK; não é possível abrir outro iframe nem navegar o contêiner; `omni.ui.openHtml` só abre HTML da própria extensão (página externa: `embed`/`omni.ui.openEmbed` + `embedOrigins`).
- **Canal**: `omni.channel.publish/subscribe` (4 KB, 10 msg/s, disjuntor), tópico isolado por instalação. Publicação externa pelo backend: seção 10.5.
- `omni.bus` / `omni.state`: comunicação gratuita entre contêineres da mesma instalação na mesma aba (ex.: painel ↔ diálogo).
- Publicação pela CDN da Kentro: no máximo **5 versões publicadas** por extensão (apague as antigas); o ponteiro de prod leva **até 15 min** para propagar (o de dev não tem cache).

### 5.3 Assistentes de IA e automações
- Assistentes aceitam **servidores MCP remotos**: `{ id, name, url, transport: "streamable-http" | "sse", auth: { type: "bearer", token }, headers?, timeout?, progresslabel? }`.
- O contexto inicial (prompt) **suporta variáveis do atendimento**.
- Funções do assistente chamam **automações**. O elemento `aiAddContextToAssistant` devolve o resultado ao contexto.
- **Captura de webhook**: URL pública `https://<instância>/webhookcapture/capture/<key>`. Executa uma automação com o payload em variáveis `capture_<campo>` (ex.: `capture_chatId`, `capture_resumo`).
- Elementos usados no evento de finalização: `searchChat` (`searchField: "id"`), `varCondition` (expressão), `info` (nota interna, só o atendente vê) e `aiProvokeAssistant` (faz a IA reagir sem mensagem do cliente).
- O botão de link (`url`) só funciona em WA Cloud API, Webchat e Telegram. Para links, use texto simples na mensagem.

---

## 6. Modelo de domínio (pacote `contratos`)

```ts
export interface Produto {
  id: string;                 // id na plataforma
  sku: string;
  nome: string;
  descricao: string;          // texto puro (sanitizado)
  descricaoCurta?: string;
  imagens: string[];          // URLs absolutas HTTPS
  preco: number;              // preço vigente (já com promoção)
  precoDe?: number;           // preço "de" quando há promoção
  unidade: string;            // "UN", "CX", "M2", "KG"...
  estoque: number | null;     // null = plataforma não controla
  disponivel: boolean;
  categoriaIds: string[];
  urlNaLoja?: string;
  variacoes: Variacao[];      // vazio = produto simples
  atributosVariacao?: string[]; // ex.: ["Cor", "Tamanho"]
}

export interface Variacao {
  id: string;
  sku: string;
  nome: string;               // ex.: "Azul / G"
  atributos: Record<string, string>; // { Cor: "Azul", Tamanho: "G" }
  preco: number;
  precoDe?: number;
  estoque: number | null;
  disponivel: boolean;
  imagem?: string;
}

export interface Categoria { id: string; nome: string; paiId?: string; ordem?: number; }

export interface Pagina<T> { itens: T[]; pagina: number; porPagina: number; total?: number; temMais: boolean; }

export interface OpcaoFrete { id: string; titulo: string; prazo?: string; valor: number; }

export interface PedidoParaCriar {
  cliente: { nome: string; telefone: string; email?: string; documento?: string };
  entrega: { tipo: 'entrega' | 'retirada'; endereco?: Endereco; lojaRetiradaId?: string };
  itens: { produtoId: string; variacaoId?: string; sku: string; quantidade: number; precoUnitario: number }[];
  frete?: { titulo: string; valor: number };
  desconto?: { valor: number; motivo: string };
  observacoes?: string;
  referenciaExterna: string;  // id da sessão Kentro Shop
}

export interface Endereco { cep: string; estado: string; cidade: string; bairro: string; rua: string; numero: string; complemento?: string; referencia?: string; }

export interface PedidoCriado { idExterno: string; numero: string; url?: string; status: string; }
```

**Item vendável:** produto simples (sem variações) ou variação. O carrinho sempre referencia o item vendável (`produtoId` + `variacaoId?`).

---

## 7. Conectores

### 7.1 Interface

```ts
export interface Conector {
  readonly id: 'ecommercenet' | 'woocommerce' | 'nuvemshop' | 'tray' | 'lojaintegrada' | string;
  readonly nome: string;
  readonly capacidades: Capacidades;
  readonly camposDeCredencial: CampoCredencial[];   // gera o formulário da aba Integração

  testarConexao(ctx: CtxConector): Promise<{ ok: true; nomeLoja?: string } | { ok: false; mensagem: string }>;
  listarCategorias(ctx: CtxConector): Promise<Categoria[]>;
  listarProdutos(ctx: CtxConector, filtro: { busca?: string; categoriaId?: string; pagina: number; porPagina: number }): Promise<Pagina<Produto>>;
  obterProduto(ctx: CtxConector, produtoId: string): Promise<Produto | null>;
  relacionados?(ctx: CtxConector, produtoId: string): Promise<Produto[]>;
  cotarFrete?(ctx: CtxConector, itens: ItemCotacao[], cep: string): Promise<OpcaoFrete[]>;
  criarPedido?(ctx: CtxConector, pedido: PedidoParaCriar): Promise<PedidoCriado>;
  // OAuth (Nuvemshop, Tray): fluxo de autorização
  urlDeAutorizacao?(ctx: CtxConector, urlRetorno: string): string;
  concluirAutorizacao?(ctx: CtxConector, params: Record<string, string>): Promise<Record<string, string>>; // novas credenciais
}

export interface Capacidades {
  buscaTextual: boolean; categorias: boolean; variacoes: boolean; estoque: boolean;
  relacionados: boolean; cotarFrete: boolean; criarPedido: boolean; oauth: boolean;
}

export interface CampoCredencial {
  chave: string; rotulo: string; tipo: 'texto' | 'segredo' | 'url' | 'select'; obrigatorio: boolean;
  ajuda?: string; opcoes?: { valor: string; rotulo: string }[];
}

export interface CtxConector {
  lojaId: string;
  credenciais: Record<string, string>;   // já decifradas, só durante a chamada
  http: ClienteHttpConector;              // nunca usar fetch direto
  salvarCredenciais(novas: Record<string, string>): Promise<void>; // renovação de token
}
```

### 7.2 Camada comum (`conectores/nucleo`)
- **`ClienteHttpConector`**: tempo limite de 8 s; **controle de ritmo por loja+plataforma** (token bucket configurável por conector); nova tentativa com espera exponencial em 429/5xx (no máximo 2); respeita `Retry-After`.
- **Registro de chamadas** em `chamadas_conector` (rota sem query sensível, status, ms, código de erro), exibido na aba Saúde.
- **Erros padronizados:** `CredencialInvalida`, `LimiteDaPlataforma`, `PlataformaIndisponivel`, `NaoEncontrado`, `RecusadoPelaPlataforma(mensagem)`. A API os traduz para mensagens em português.
- **Registro de conectores:** `RegistroConectores.obter(id)`. Adicionar uma plataforma = criar a pasta e registrar. Nada mais muda.

### 7.3 Bateria de testes de contrato
Uma suíte genérica (`conectores/nucleo/contrato.spec.ts`) roda contra **cada** conector, com HTTP simulado a partir de **respostas reais gravadas** (fixtures em `conectores/<id>/fixtures/`). Ela verifica: o modelo normalizado (tipos, preços numéricos, URLs HTTPS), paginação, produto com e sem variação, busca vazia, credencial inválida → `CredencialInvalida`, 429 → nova tentativa, e as capacidades declaradas coerentes com os métodos implementados. **Nenhum conector entra sem passar.**

### 7.4 Regras da loja por cima do produto
`CatalogoService` = conector + `regras_produto` da loja. Aplica, por SKU:
- `oculto`: remove da listagem;
- `selo`: ex.: "Mais vendido";
- `m2PorUnidade`, `rendimentoM2`: habilitam a calculadora;
- `compreJunto`: lista manual de SKUs, que se soma ao `relacionados()` nativo quando existir.

A regra é sempre aplicada **por cima** do produto ao vivo; o produto em si nunca é gravado.

### 7.5 Notas por plataforma (⚠ confirmar tudo na documentação oficial antes de implementar)
1. **eCommerce-net (MVP):** token = `base64(client_id:client_secret)` no cabeçalho `Authorization`. Rotas úteis: `/product/all` (página, limite ≤ 200, busca, categoria), `/product/findbysearch`, `/category/findbyname` (sem nome = todas), `/product/findvarietybyproductskuv2`, `/product/findbuyitwithbysku` (compre junto), `/product/findRelatedBySku`, `/freight/getfreight` (hash do carrinho + CEP), `/cart/*`, `/order/insertorder`, `/customer/insert`. O OpenAPI completo está na demo. Atenção: tipos inconsistentes (números como string); normalize. Frete e pedido dependem de um carrinho/hash da própria plataforma: o conector precisa criar esse carrinho espelho na hora de cotar ou criar o pedido.
2. **WooCommerce:** URL da loja + consumer key/secret (API REST v3). Exige HTTPS na loja. Variações em rota separada por produto.
3. **Nuvemshop:** app de parceiro com OAuth (rota de retorno na nossa API), `store_id` + access token, cabeçalho de autenticação próprio e `User-Agent` com contato obrigatório.
4. **Tray:** consumer key/secret + código → access token **com expiração e renovação** (use `salvarCredenciais`).
5. **Loja Integrada:** chave de API da loja + chave de aplicação de parceiro.

**Burocracia (dono do produto):** os cadastros de parceiro/desenvolvedor na Nuvemshop, Tray e Loja Integrada levam dias. Devem ser iniciados já.

---

## 8. API

Prefixo `/v1`. JSON. Erro padrão: `{ "erro": { "codigo": "CREDENCIAL_INVALIDA", "mensagem": "texto em português" } }`.

### 8.1 Autenticação
| Quem | Como |
|---|---|
| Extensão de atendimento (painel) | `X-Loja-Chave: <chave_atendimento>` (via `omni.http.request`). Só rotas de atendimento |
| Extensão de admin (Configurações) | `X-Loja-Chave: <chave_admin>`. Rotas de configuração e de atendimento. A separação vem das duas extensões (seção 10.0), não de cabeçalho |
| Auditoria (ambas) | `X-Kentro-Usuario-Id` e `X-Kentro-Usuario-Nome`, a partir de `ctx.user`. Servem só para registrar quem fez o quê nos eventos; são montados no navegador e não valem como autorização |
| Catálogo do cliente | Token da sessão na URL |
| Assistente (MCP) | `Authorization: Bearer <token MCP da loja>` |
| Superadmin | `Authorization: Bearer <TOKEN_SUPERADMIN>` |

No banco ficam **apenas hashes** (SHA-256) da `chave_admin`, da `chave_atendimento` e do token MCP.

### 8.2 Rotas
**Lojas e configuração (extensão):**
- `POST /v1/lojas/registrar` → `{ lojaId, chaveAdmin, chaveAtendimento, tokenMcp }` (aberta; a loja nasce `pendente_integracao`). Limite de **5 por hora por IP + instância da Kentro** (cabeçalho `X-Kentro-Instancia`, enviado pela extensão a partir de `ctx.instance.domain`). Motivo: as chamadas das extensões saem todas do IP do backend da Kentro, e um limite só por IP deixaria uma instância esgotar o cadastro de todas as outras.
- `GET /v1/loja` (aceita as duas chaves e devolve `{ id, nome, status, plano, papel }`, para o painel mostrar "conectado") · `PATCH /v1/loja/configuracoes` (tema, entrega, frete, lojas de retirada, modo de pedido, expiração do link, URL da captura).
- `GET /v1/conectores` (lista, capacidades e campos de credencial).
- `PUT /v1/loja/integracao` `{ plataforma, credenciais }` · `POST /v1/loja/integracao/testar`.
- `GET /v1/loja/integracao/oauth/iniciar` · `GET /v1/oauth/retorno/:plataforma` (OAuth).
- `GET/PUT/DELETE /v1/loja/regras/:sku` · `GET /v1/loja/regras`.
- `POST /v1/loja/token-mcp/rotacionar` · `POST /v1/loja/chave-admin/rotacionar` · `POST /v1/loja/chave-atendimento/rotacionar`.
- Todas as rotas desta lista, exceto `registrar`, exigem a `chave_admin`.
- `GET /v1/loja/saude` (últimas chamadas e erros do conector, uso do mês, plano).
- `POST /v1/loja/ia/testar-evento` (dispara o webhook de teste).

**Atendimento (painel):**
- `POST /v1/sessoes` `{ chatId, nome, telefone }` → sessão + `url` (reaproveita a aberta do mesmo chat).
- `GET /v1/sessoes/chat/:chatId` → sessão, itens, totais, eventos, resumo em texto, pedido.
- `PATCH /v1/sessoes/:id/itens` (atendente edita quantidade e remove) · `POST /v1/sessoes/:id/desconto` `{ valor, motivo }`.
- `POST /v1/sessoes/:id/criar-pedido` (só no modo `criar_pedido` e com `criarPedido` disponível).

**Catálogo (público, token da sessão):**
- `GET /c/:token` (página) · `GET /v1/catalogo/:token/abrir` (marca "navegando"; devolve tema, sessão e cliente).
- `GET /v1/catalogo/:token/categorias` · `GET /v1/catalogo/:token/produtos?busca&categoria&pagina` · `GET /v1/catalogo/:token/produtos/:id` (com regras e compre junto).
- `PUT /v1/catalogo/:token/carrinho` `{ itens: [{ produtoId, variacaoId?, quantidade }] }` (revalida ao vivo os itens alterados).
- `POST /v1/catalogo/:token/frete` `{ cep }` · `POST /v1/catalogo/:token/finalizar` (revalida tudo; pode responder `409 PRECOS_ALTERADOS` com a lista de diferenças).

**MCP:** `POST /mcp` (streamable-http), seção 11.

**Superadmin:** `GET /v1/admin/lojas` · `PATCH /v1/admin/lojas/:id` `{ status, plano, limites }`.

**Saúde:** `GET /` → `{ ok: true }`.

---

## 9. Catálogo do cliente (`storefront/`)

**Mobile-first** (projetar em 360–390 px; desktop é adaptação). Telas validadas na demo (seção 19):
- **Topo:** faixa da marca (logo, nome e "Olá, {primeiro nome}!") rola com a página. Busca, botão do carrinho com contador e categorias em chips horizontais ficam **presos** no topo.
- **Vitrine:** grade de 2 colunas; card com imagem, selo, nome curto, preço por m² quando aplicável, preço "de/por" e "✓ N no carrinho". Paginação por rolagem infinita (o proxy ao vivo traz 24 por página).
- **Detalhe:** folha que sobe de baixo; imagem na largura toda; variações como chips com amostra de cor; descrição; estoque ("Últimas N"); **calculadora de m²** (área + 10% de perda → caixas) quando há `m2PorUnidade`; barra **fixa no rodapé** com quantidade e "Adicionar"; **Compre junto** com a quantidade sugerida pela metragem (`rendimentoM2`).
- **Carrinho:** itens com quantidade, remover e subtotal; "Continuar".
- **Finalização:** entrega ou retirada (conforme a loja liga); entrega com nome, telefone formatado (o número vem da Kentro com DDI 55), **CEP com ViaCEP** (preenche rua, bairro, cidade e UF), número, complemento e referência; frete conforme a regra da loja; retirada com cartões das lojas (endereço, horário, orientações); observações; "Enviar pedido para o atendente".
- **Confirmação:** resumo do pedido e "Você já pode voltar para a conversa".
- **Revalidação:** se `finalizar` responder `PRECOS_ALTERADOS`, mostrar as diferenças e pedir confirmação.
- Avisos flutuantes no **topo** (no rodapé cobrem botões). Ao voltar para a página (`visibilitychange`), recarregar o carrinho do servidor; ao sair com alteração pendente, enviar antes.
- **Tema da loja:** cor principal, logo, nome e boas-vindas via variáveis CSS.
- Imagens com `loading="lazy"`; assets versionados (`?v=`) ou com hash para evitar cache velho após deploy.
- **Link expirado ou inválido:** tela amigável "Peça um novo link no WhatsApp".

---

## 10. Extensão (`extension/`)

### 10.0 Duas extensões (decidido em 09/10/2026)
O Kentro Shop é distribuído como **duas extensões separadas**, cada uma com o seu manifest, a sua instalação e a sua chave:

| | Kentro Shop — Atendimento | Kentro Shop — Admin |
|---|---|---|
| `id` | `kentro.shop` | `kentro.shop-admin` |
| Pasta | `extension/atendimento/` | `extension/admin/` |
| Contribuições | `chatPanel` (painel do atendimento) | `topMenu` (Configurações) |
| Quem recebe | agentes, supervisores e admins | **só administradores** (`visibility` + filtro da instalação `userTypes: [0]`) |
| Chave na configuração | `chave_atendimento` | `chave_admin` |
| O que a chave libera na API | rotas de atendimento (seção 8.2, "Atendimento") | rotas de configuração e de atendimento |

**Motivo:** a Kentro entrega `ctx.config`, com os secrets decifrados, a todos que recebem a extensão. Com uma extensão só, a chave que libera a configuração chegaria ao navegador dos atendentes. Separando, a chave de admin só existe na instalação que os atendentes não recebem, e não há senha extra para o admin guardar ou digitar.

⚠ Verificar na Fase 0: confirmar que um usuário fora dos filtros da instalação admin não recebe o `ctx.config` dela (instalar com filtro `userTypes: [0]`, abrir com um agente de teste e conferir que nada monta).

### 10.1 Manifests (rascunho)
```json
{
  "manifestVersion": 1,
  "id": "kentro.shop",
  "version": "1.0.0",
  "name": "Kentro Shop — Atendimento",
  "description": "Catálogo de e-commerce no atendimento: link para o cliente, carrinho ao vivo e pedido para o atendente.",
  "author": { "name": "Kentro Shop" },
  "requires": [],
  "config": [
    { "key": "api_url", "type": "url", "label": "Endereço da API do Kentro Shop", "required": true, "default": "<URL_PUBLICA da API, definida na Fase 0>" },
    { "key": "chave_atendimento", "type": "secret", "label": "Chave de atendimento (gerada no Kentro Shop — Admin)", "required": true }
  ],
  "contributions": [
    { "id": "painel", "type": "chatPanel", "title": "Kentro Shop", "url": "painel.html" }
  ]
}
```
```json
{
  "manifestVersion": 1,
  "id": "kentro.shop-admin",
  "version": "1.0.0",
  "name": "Kentro Shop — Admin",
  "description": "Configuração do Kentro Shop: integração com o e-commerce, catálogo, entrega, pedidos e IA. Instale só para administradores.",
  "author": { "name": "Kentro Shop" },
  "requires": [],
  "config": [
    { "key": "api_url", "type": "url", "label": "Endereço da API do Kentro Shop", "required": true, "default": "<URL_PUBLICA da API, definida na Fase 0>" },
    { "key": "chave_admin", "type": "secret", "label": "Chave de admin (gerada ao criar a loja)", "required": false }
  ],
  "contributions": [
    { "id": "configuracoes", "type": "topMenu", "title": "Kentro Shop", "url": "config.html",
      "presentation": { "mode": "dialog", "size": "xl" }, "visibility": { "userTypes": [0] } }
  ]
}
```
(Conferido com `extensions_manifest_spec` em 07/10/2026: chaves, tipos, `visibility`, modos e o formato de `id` com hífen são aceitos. Na instalação admin, `chave_admin` não é obrigatória porque ela só existe depois do registro, que é feito pela própria tela.)

### 10.2 Identidade da loja (revisado na Fase 0)
Não existe armazenamento compartilhado entre os usuários de uma instalação (seção 5.4), então as chaves ficam na configuração de cada instalação:
1. O admin instala o **Kentro Shop — Admin** com filtro só para administradores e abre Configurações. Sem `ctx.config.chave_admin`, a tela oferece "Criar minha loja no Kentro Shop" (clique explícito, para não criar lojas órfãs) e "Já tenho uma chave" (para reinstalação).
2. `POST /v1/lojas/registrar` devolve `chaveAdmin`, `chaveAtendimento` e `tokenMcp`, mostrados **uma vez**, com botões "Copiar" e o passo a passo:
   - colar a `chave_admin` na configuração da instalação **Kentro Shop — Admin**;
   - instalar o **Kentro Shop — Atendimento** e colar a `chave_atendimento` na configuração dele.
   Até a tela ser recarregada, as chaves ficam em memória e no `omni.storage` do admin, para não se perderem se ele fechar o diálogo antes de colar.
3. O painel do atendimento relê `ctx.config.chave_atendimento` ao montar. Se ela estiver ausente ou inválida, mostra "Peça ao administrador para configurar o Kentro Shop".
4. A aba Saúde permite rotacionar cada chave separadamente. A rotação mostra a chave nova uma vez, com o mesmo passo a passo de colar.

### 10.3 Painel do atendimento (`painel.html`)
Base: `extensao/index.html` da demo. Inclui:
- gerar e copiar link;
- status com etapas;
- histórico de atividade;
- carrinho ao vivo **editável** (quantidade, remover, desconto com motivo);
- resumo do handoff + "Copiar resumo";
- modo `criar_pedido`: botão "Enviar pedido ao e-commerce" com confirmação (`omni.ui.confirm`), número e link do pedido;
- estados vazios e de erro claros (loja sem integração, chave inválida, plataforma fora do ar).

Consulta a cada 5 s só com o painel visível e pedido não fechado.

### 10.4 Configurações (`config.html`, só admin) — abas
1. **Integração:** escolher a plataforma → formulário gerado por `camposDeCredencial` (ou botão "Conectar" para OAuth) → "Testar conexão" → capacidades suportadas.
2. **Catálogo:** nome, logo (URL), cor principal, boas-vindas, expiração do link (dias), categorias ocultas; prévia do link.
3. **Entrega e retirada:** liga/desliga cada uma; lojas de retirada (CRUD); regra de frete: `plataforma` (se `cotarFrete`), `fixo`, `gratis_acima_de`, `a_combinar`.
4. **Regras de produtos:** busca ao vivo no conector → editar m² por caixa, rendimento, selo, ocultar, compre junto (busca de SKUs).
5. **Pedidos:** modo `handoff | criar_pedido` (desabilitado se o conector não suporta), status inicial.
6. **IA:** passo a passo da seção 11.4 com botões "Copiar" e "Testar integração".
7. **Saúde:** status da integração, últimas 50 chamadas ao conector com erros destacados, uso do mês versus limites do plano, rotação de chave e token.

### 10.5 Tempo real
- **MVP:** consulta periódica (acima).
- **Fase 4:** canal de mensagens da instalação na Kentro (limites de 10 msg/s, rajada 20, 4 KB). A API publica `{ chatId }` (só identificadores) e o painel recarrega. Rota confirmada na documentação oficial:
  ```http
  POST https://{instancia}/api/extensions/{installId}/channel
  Authorization: Bearer {channeltoken}
  { "topic": "carrinho", "payload": { "chatId": "123" }, "to": "type:agent" }
  ```
  `installId` vem de `ctx.contribution.installId` e `{instancia}` de `ctx.instance.domain`. A extensão pode enviá-los à API sozinha. O `channeltoken` **não** chega à extensão: quem administra a instância o gera (Gestão de extensões, ou `extension_installs_rotate_token`), e ele aparece uma única vez. Logo, a aba Configurações precisa de um campo "Token do canal (opcional)" que a API guarda cifrado. Sem o token, o painel continua na consulta periódica. Respostas: 401 (token inválido ou instalação desabilitada), 429 `E_RATE_LIMITED` / `E_CHANNEL_BREAKER`. `delivered: 0` não é erro. Alvo sugerido: `type:agent` mais `type:supervisor`, ou `user:<id>` do atendente do chat quando conhecido.

---

## 11. Integração com a IA

### 11.1 Servidor MCP (`/mcp`, Bearer = token MCP da loja)
| Ferramenta | Entrada | Saída (texto enxuto para o modelo) |
|---|---|---|
| `buscar_produtos` | `busca?`, `categoria?`, `limite?` (padrão 8) | Lista: nome, id, preço (e por m²), unidade, variações com estoque, compre junto, regras |
| `detalhes_produto` | `produto_id` | Ficha completa |
| `gerar_link_catalogo` | `chat_id`, `nome?`, `telefone?` | `{ url }` + instrução "envie este link ao cliente" |
| `consultar_carrinho` | `chat_id` | Itens, totais, status |
| `info_loja` | — | Lojas de retirada, horários, regra de frete, modo de pedido |

O modelo de saída para a IA é o formato validado na demo (`/api/catalogo/resumo-ia`): uma linha por produto, com tudo o que ela precisa para recomendar sem inventar.

### 11.2 Identificação do atendimento
O prompt gerado contém "ID deste atendimento: `{{chat_id}}`" para a IA passar às ferramentas. Confirmado na documentação (Fase 0): o campo de contexto inicial "suporta variáveis" com a mesma sintaxe `{{...}}` das automações, e `chat_id` (número) é variável oficial do atendimento. Também servem `{{chat_client_name}}` e `{{chat_client_number}}` para pré-preencher nome e telefone. Falta o teste empírico num chat real (seção 17, item 4). **Plano B:** automação `request` + função do assistente, como na demo (automação 109).

### 11.3 Evento de finalização
Ao finalizar uma sessão, se a loja tem `urlCapturaKentro`, a API faz POST:
```json
{ "evento": "carrinho_finalizado", "chatId": "123", "sessaoId": "…", "cliente": { "nome": "…", "telefone": "…" },
  "tipo": "entrega", "total": 1937.9, "itens": 20, "resumo": "Resumo do atendimento\n\nCliente: …" }
```
Automação na Kentro, testada na demo como automação 108:
1. `searchChat` por `id` = `{{capture_chatId}}`;
2. `varCondition`: segue só se `chat_id * 1 == capture_chatId * 1`;
3. `info` com `{{capture_resumo}}`;
4. `aiProvokeAssistant` com instruções para confirmar e transferir.

Falha no POST **não** pode quebrar a finalização (registrar e seguir).

### 11.4 Aba IA (passo a passo para o admin)
1. Copiar a URL `/mcp` e o token MCP → colar como servidor MCP na assistente.
2. Copiar o **bloco de prompt** gerado com os dados da loja (seção 11.5) → colar no contexto da assistente.
3. Criar a captura de webhook e a automação de 4 elementos (instruções ilustradas) → colar a URL da captura.
4. "Testar integração": envia um evento de teste e mostra o resultado.

### 11.5 Bloco de prompt (modelo)
Baseado na assistente "Ana" da demo:
- persona e tom (curto, 1 emoji no máximo);
- papel de pré-atendimento (não fecha a venda);
- fluxo: recepção → necessidade (uma pergunta por vez) → `buscar_produtos` antes de citar preço → 2 a 3 opções → complementares com quantidade pela metragem → `gerar_link_catalogo` → tirar dúvidas → no "EVENTO DO CATÁLOGO", confirmar e transferir com o marcador `pedido_finalizado`;
- dados da loja (retirada, frete);
- regras: nunca inventar preço, estoque ou prazo; não dar desconto; transferir se pedirem humano ou houver reclamação.

---

## 12. Banco de dados (Prisma)

A Fase 0 criou só a tabela `lojas` (migração `inicial`). Cada tabela abaixo entra, com a sua própria migração, na fase que a usa.

| Tabela | Colunas principais |
|---|---|
| `lojas` | id (uuid), nome, chave_admin_hash, chave_atendimento_hash, token_mcp_hash, status (`pendente_integracao`, `ativa`, `bloqueada`), plano, limites (json), criado_em |
| `integracoes` | loja_id (único), plataforma, credenciais_cifradas (bytea), iv, status, ultimo_teste_em, ultimo_erro |
| `configuracoes_loja` | loja_id, tema (json), entrega (json), frete (json), lojas_retirada (json), modo_pedido, status_pedido_inicial, expiracao_link_dias, categorias_ocultas (text[]), url_captura_kentro |
| `regras_produto` | loja_id, sku (único por loja), oculto, selo, m2_por_unidade, rendimento_m2, compre_junto (text[]) |
| `sessoes` | id, loja_id, token (único), chat_id, cliente (json), status (`link_enviado`, `navegando`, `finalizado`, `pedido_criado`, `expirado`), checkout (json), totais (json), desconto (json), aberta_em, finalizada_em, expira_em; índice (loja_id, chat_id) |
| `itens_carrinho` | sessao_id, produto_id, variacao_id, sku, nome, variacao_nome, imagem, unidade, preco_unitario, quantidade, m2, revalidado_em |
| `eventos_sessao` | sessao_id, tipo, texto, autor (`cliente`, `atendente`, `sistema`, `ia`), em |
| `pedidos` | sessao_id, plataforma, id_externo, numero, url, status, erro, criado_em |
| `chamadas_conector` | loja_id, plataforma, operacao, status_http, ms, erro_codigo, em (removidas após 7 dias) |
| `uso_mensal` | loja_id, mes, links_gerados, chamadas_conector, pedidos_criados |

**Toda consulta filtra por `loja_id`**: use um repositório ou middleware que injete o filtro, e um teste que tente ler dados de outra loja.

---

## 13. Segurança e LGPD
- **HTTPS com domínio** na API e na extensão. O IP:porta da demo é só para teste: passa pouca confiança, a Kentro (HTTPS) bloqueia imagens HTTP e a WooCommerce exige HTTPS.
- Credenciais do e-commerce com **AES-256-GCM** (`CHAVE_MESTRA_CRIPTO` na variável de ambiente; IV por registro), decifradas só durante a chamada, nunca logadas nem devolvidas (as leituras mostram `••••`).
- `chave_admin`, `chave_atendimento` e token MCP: aleatórios (32 bytes), mostrados uma vez, guardados como hash, com rotação independente.
- Token de sessão do catálogo: aleatório, sem dados no link; expira.
- Limite de requisições por IP nas rotas públicas e no registro de lojas.
- Preço **sempre** calculado no servidor.
- Validação de todas as entradas (`class-validator`); sanitizar HTML das descrições vindas das plataformas antes de exibir.
- LGPD: dados de cliente mínimos (nome, telefone, endereço da entrega); tarefa diária apaga sessões expiradas há mais de 30 dias e os logs de conector com mais de 7 dias.
- Nunca colocar segredos em código ou em documentos (na demo, a chave ficou no `config.ts`; não repetir).

---

## 14. Operação
- Contêiner único e sem estado em memória (tudo no Postgres); migrações Prisma no start.
- Logs estruturados (JSON) com `lojaId` e `requestId`; sem dados pessoais.
- Tarefas agendadas (`@nestjs/schedule`): expirar sessões, limpar logs, consolidar uso mensal.
- Versionamento da extensão: subir `version` no manifest a cada deploy do projeto Extensão; assets com versão na URL.

---

## 15. Testes
- **Unitários:** cálculo de totais, aplicação de regras, revalidação (preço mudou, estoque acabou, item removido da plataforma), máquina de status da sessão.
- **Contrato por conector** (seção 7.3), obrigatório.
- **API ponta a ponta** (Postgres de teste): registrar loja → integrar com conector falso → gerar link → carrinho → finalizar → webhook recebido → criar pedido; isolamento entre lojas; autenticação de cada rota.
- **Catálogo:** Playwright em viewport 390×844 (fluxo completo, calculadora, compre junto, CEP com ViaCEP simulado).
- **Extensão:** página de teste com `omni` simulado (como na demo) para painel e configurações.
- CI: build + testes antes de qualquer deploy.

---

## 16. Fases e critérios de aceite

**Fase 0 — Fundação**
- Monorepo, API com Prisma e migrações, registro de loja, criptografia, guardas de autenticação, esqueleto da extensão (painel e configurações vazios), deploy dos dois projetos na VPS com domínio HTTPS.
- **Aceite:** a extensão instala numa Kentro de teste pela URL do manifest hospedado na VPS; todos os itens ⚠ da seção 17 respondidos e registrados neste documento.

**Fase 1 — MVP (primeiro cliente: Shopping dos Pisos, eCommerce-net)**
- Conector eCommerce-net (catálogo, categorias, variações, compre junto; frete opcional), regras por SKU via banco (sem tela ainda), catálogo completo, sessões com revalidação, painel (sem edição do carrinho), Configurações (Integração, Catálogo, Entrega, Pedidos em `handoff`, IA, Saúde básica), MCP, evento de finalização.
- **Aceite:** um admin configura a loja sozinho em menos de 15 min; a IA busca produtos, envia o link, o cliente compra no celular, o atendente vê ao vivo e a IA confirma e transfere.

**Fase 2**
- Modo `criar_pedido` (eCommerce-net), atendente editando o carrinho e dando desconto, tela de Regras de produtos, Saúde completa, conector WooCommerce.
- **Aceite:** pedido criado na plataforma com número exibido no painel e na conversa; WooCommerce passa na bateria de contrato.

**Fase 3**
- Nuvemshop (OAuth), Tray (token com renovação), Loja Integrada.
- **Aceite:** os três passam na bateria de contrato e operam numa loja real de teste.

**Fase 4**
- Tempo real pelo canal da Kentro, aplicação dos limites de plano, cache opcional atrás da interface de conector, configuração da IA em um clique (se a Kentro oferecer API para isso).

---

## 17. Premissas a verificar na Fase 0 (⚠)
1. A VPS, no tipo "Extensão", serve o `manifest.json` com `Access-Control-Allow-Origin`. **Se não:** publicar a extensão pelo editor de extensões da Kentro (CDN `cdn.a-tend.online`) e manter só a API na VPS.
2. O SDK oferece armazenamento por instalação compartilhado entre usuários. **Se não:** plano B da seção 10.2.
3. O contexto do SDK expõe o tipo e o id do usuário atual (para auditoria e ações de admin).
4. O contexto inicial da assistente resolve `{{chat_id}}`. **Se não:** plano B da seção 11.2.
5. O servidor MCP da API é aceito pela assistente da Kentro (transporte `streamable-http`, Bearer) e as ferramentas aparecem para o modelo.
6. Como obter o token e a rota de publicação no canal da instalação (Fase 4).
7. Os limites reais de requisição de cada plataforma (para configurar o controle de ritmo).
8. A cota de uso de IA da instância Kentro de teste (na demo ela estava esgotada: `limit_reached`).

### 17.1 Respostas (verificação de 07/10/2026, instância kentro.atenderbem.com)
Fontes: MCP de configuração da Kentro (`extensions_manifest_spec`, `extension_installs_list`, `assistants_get`, `automations_get_variables`), ajuda oficial do editor de extensões (salva em `docs/kentro/sdk-omni-referencia.md`) e documentação pública das plataformas.

| # | Status | Resposta |
|---|---|---|
| 1 | **Decidido: VPS** | O dono do produto decidiu (07/10/2026) hospedar a extensão **na VPS**, ajustando a VPS no que for preciso; a CDN da Kentro não será usada. Requisitos na seção 4.3. Referência: a CDN da Kentro devolve `Access-Control-Allow-Origin: *`, e é esse o comportamento a reproduzir. O teste na VPS fica para o deploy da Fase 0. |
| 2 | **Não** | `omni.storage` é por usuário **e** por dispositivo. "Compartilhar armazenamento" não muda isso. Plano B adotado como caminho principal (seção 10.2). |
| 3 | **Sim** | `ctx.user` = `{ id, name, type, email, queues, groups }` e `ctx.user.permissions.isAdmin`. Ressalva de segurança na seção 8.1. |
| 4 | **Sim, pela documentação** | O contexto inicial "suporta variáveis" e `{{chat_id}}` é variável oficial. Falta o teste empírico: um chat de teste com uma assistente cujo prompt imprima o ID (depende do item 8). |
| 5 | **Sim, pela documentação** | O campo `mcp` da assistente aceita `transport: "streamable-http"` e `auth: { type: "bearer", token }` (também `api-key`, `basic`, `oauth`), além de `progresslabel`. Falta o teste empírico com o `/mcp` da API publicado (Fase 0, depois do deploy). Use `progresslabel` em português, porque sem ele o cliente vê uma frase genérica. |
| 6 | **Sim** | `POST https://{instância}/api/extensions/{installId}/channel` com `Bearer {channeltoken}`. O token é gerado pelo admin da instância e mostrado uma vez. Detalhes na seção 10.5. |
| 7 | **Parcial** | Ver tabela 17.2. |
| 8 | **Não verificável pelo MCP** | Nenhuma ferramenta do MCP de configuração mostra a cota de IA. Conferir no painel da instância antes dos testes dos itens 4 e 5. |

### 17.2 Limites de requisição por plataforma (item 7)
| Plataforma | Limite | Fonte / confiança | Configuração inicial do controle de ritmo |
|---|---|---|---|
| eCommerce-net | **Não documentado** no OpenAPI (só `limit` ≤ 200 por página) | `docs/ecommercenet/openapi.json`. Perguntar ao suporte | 2 req/s, rajada 5. Ajustar ao observar 429 |
| WooCommerce | A API REST v3 autenticada **não tem limite nativo**. O limite da Store API é opcional e só vale para POST. Na prática quem limita é a hospedagem ou o WAF | developer.woocommerce.com | 5 req/s, rajada 10, respeitar `Retry-After` |
| Nuvemshop | Leaky bucket: **40 de capacidade, 2 req/s** por loja e app (×10 nos planos Next/Evolution). Cabeçalhos `x-rate-limit-limit/remaining/reset` | dev.nuvemshop.com.br (oficial) | Bucket 40 / 2 req/s, lendo os cabeçalhos |
| Tray | **Não confirmado.** A busca só trouxe o tray.ai, outro produto (30 req/s), que **não** vale aqui | Consultar developers.tray.com.br no cadastro de parceiro | 1 req/s até confirmar |
| Loja Integrada | **Não confirmado.** Uma fonte citou 300 req / 5 min por IP, mas não está claro se é a Loja Integrada | Consultar a documentação de parceiro | 1 req/s até confirmar |

---

## 18. Fora de escopo
Pagamento online no catálogo; sincronização ou cópia do catálogo; uso do catálogo/carrinho nativos da Kentro; aplicativo mobile; marketplace (várias lojas num catálogo só); painel de superadmin com interface (só rotas).

---

## 19. Referências (demo funcional)
Repositório `shopping_dos_pisos` (GitHub `mateusdev2311/shopping-dos-pisos-catalogo`), validado ponta a ponta:
- `public/loja.html|css|js`: catálogo mobile (portar para Preact preservando o comportamento).
- `extensao/index.html`: painel do atendimento com `omni` SDK (base do `painel.html`).
- `src/sessoes/sessoes.service.ts`: sessão, carrinho, eventos, resumo do handoff, webhook.
- `src/catalogo/catalogo.service.ts` (`resumoParaIa`): formato de produtos para a IA.
- `src/catalogo/dados/catalogo.json`: exemplo de dados no formato eCommerce-net.
- `test/fluxo.test.js`: modelo de teste ponta a ponta.
- OpenAPI da eCommerce-net: arquivo `api shopping dos pisos.txt` fornecido pelo dono do produto, copiado para `docs/ecommercenet/openapi.json`.
- Referência oficial do SDK `omni.*` (ajuda do editor de extensões da Kentro): `docs/kentro/sdk-omni-referencia.md`.
- Na instância kentro.atenderbem.com: extensão `mateus.shoppingdospisos`, automações 108 (finalização), 109 (link), 110 (consulta), assistente 2 ("Ana").
