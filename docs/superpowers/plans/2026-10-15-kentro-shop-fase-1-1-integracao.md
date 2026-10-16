# Kentro Shop — Fase 1.1 (Integração eCommerce-net) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** a loja conecta a sua conta eCommerce-net pela tela do admin (credenciais cifradas, teste de conexão) e a API passa a listar categorias e produtos **ao vivo**, normalizados para o modelo do Kentro Shop e com as regras da loja aplicadas por cima.

**Arquitetura:** os conectores ficam atrás de uma interface única (`Conector`), com um cliente HTTP comum (timeout, ritmo por loja e plataforma, novas tentativas, registro de chamadas) e uma bateria de testes de contrato que roda contra cada conector com respostas gravadas. O `CatalogoService` junta conector e `regras_produto`. Nada do catálogo é gravado no banco (D7).

**Tecnologias:** as mesmas da Fase 0 (NestJS 10, Prisma 6, Jest, jsdom), mais o `fetch` nativo do Node, sem bibliotecas novas.

**Spec:** `docs/superpowers/specs/2026-10-07-kentro-shop-design.md`: seções 6, 7.1 a 7.5, 8.2 (integração e regras), 10.4 (aba Integração), 12 (`integracoes`, `chamadas_conector`, `regras_produto`), 13 e 17.2.

**Fase 1, dividida em planos** (cada um entrega software funcionando sozinho):
- **1.1 Integração eCommerce-net** (este plano).
- **1.2 Sessões, carrinho, catálogo no celular e painel do atendente.**
- **1.3 Configurações da loja:** Catálogo, Entrega e retirada, Pedidos em handoff, Saúde básica.
- **1.4 IA:** servidor MCP, evento de finalização e aba IA.

## Restrições globais
- **Sem commits e sem `git init`.** O usuário commita; cada "Ponto de commit" só avisa o que mudou.
- Código, nomes e textos em português do Brasil. Erro padrão `{ erro: { codigo, mensagem } }`.
- Pacote npm único na raiz. Testes com `npm test`; build com `npm run build`.
- **Toda consulta filtra por `loja_id`.** Cada tabela nova ganha um teste que tenta ler dados de outra loja.
- Credenciais do e-commerce: AES-256-GCM via `cifrar`/`decifrar` (Fase 0), decifradas só durante a chamada, **nunca logadas nem devolvidas**. As leituras mostram `••••` no lugar dos segredos.
- O conector nunca chama `fetch` direto: só pelo `ClienteHttpConector`.
- Ritmo inicial da eCommerce-net: **2 req/s com rajada de 5** (spec 17.2; o limite real não é documentado).
- Imagens sempre em URL absoluta **https**. Descrição em texto puro (HTML removido).
- Sem novas dependências de produção.

## Foco de revisão
1. **Credencial com espaço ou quebra de linha colada pelo admin** → aparar antes de cifrar; o teste de conexão usa o valor aparado. Teste na Tarefa 3.
2. **Plataforma devolve número como texto, vazio ou `null`** (`"129.90"`, `""`, `"0.00"`) → preço vira número; `promotional_price` `"0.00"` ou vazio significa **sem promoção**, não preço zero. Teste na Tarefa 5.
3. **A eCommerce-net responde `200` com `success: false`** → tratar como erro da plataforma, nunca como lista vazia. Teste na Tarefa 5.
4. **Loja sem integração** chama rota de catálogo → 409 `SEM_INTEGRACAO` com mensagem clara, nunca 500. Teste na Tarefa 6.
5. **Plataforma lenta ou fora do ar** → 8 s de timeout, 2 novas tentativas, depois 502 `PLATAFORMA_INDISPONIVEL`; a chamada fica registrada em `chamadas_conector`. Teste na Tarefa 2.

---

## Estrutura de arquivos

```
api/src/
  contratos/modelo.ts                 Produto, Variacao, Categoria, Pagina, (seção 6)
  conectores/nucleo/conector.ts       Conector, Capacidades, CampoCredencial, CtxConector
  conectores/nucleo/erros.ts          erros padronizados + traduzirErroConector()
  conectores/nucleo/cliente-http.ts   ClienteHttpConector (timeout, ritmo, novas tentativas, registro)
  conectores/nucleo/ritmo.ts          BaldeDeFichas (token bucket)
  conectores/nucleo/registro.ts       RegistroConectores
  conectores/nucleo/texto.ts          htmlParaTexto, numero, urlHttps
  conectores/ecommercenet/ecommercenet.conector.ts
  conectores/ecommercenet/normalizar.ts
  conectores/ecommercenet/fixtures/*.json
  conectores/conectores.module.ts
  integracoes/integracoes.service.ts  integracoes.controller.ts  dto.ts
  catalogo/catalogo.service.ts        catalogo.controller.ts (rota de prévia)
  regras/regras.service.ts            regras.controller.ts  dto.ts
api/prisma/migrations/*_integracao/   integracoes, chamadas_conector, regras_produto
api/test/
  conectores/contrato.spec.ts         bateria genérica (roda para cada conector)
  conectores/ecommercenet.spec.ts     casos específicos da plataforma
  cliente-http.spec.ts  texto.spec.ts  integracoes.e2e-spec.ts  catalogo.e2e-spec.ts
  regras.e2e-spec.ts  config-admin-integracao.spec.ts
  conectores/conector-falso.ts        conector em memória para os testes e2e
scripts/gravar-fixtures-ecommercenet.mjs
extension/admin/config.html           ganha a aba Integração
```

---

### Tarefa 1: Modelo de domínio, interface `Conector` e erros padronizados

**Arquivos:** criar `api/src/contratos/modelo.ts`, `conectores/nucleo/conector.ts`, `conectores/nucleo/erros.ts`, `conectores/nucleo/texto.ts`. Testes: `api/test/texto.spec.ts`, `api/test/erros-conector.spec.ts`.

**Interfaces:**
- Produz:
  - `modelo.ts`: os tipos da spec, seção 6, **copiados exatamente** (`Produto`, `Variacao`, `Categoria`, `Pagina<T>`, `OpcaoFrete`, `Endereco`, `PedidoParaCriar`, `PedidoCriado`).
  - `conector.ts`: as interfaces da spec, seção 7.1, exatamente (`Conector`, `Capacidades`, `CampoCredencial`, `CtxConector`), com `ClienteHttpConector` importado da Tarefa 2 (por enquanto, um `type` declarado no próprio arquivo).
  - `erros.ts`:
    - classes `CredencialInvalida`, `LimiteDaPlataforma`, `PlataformaIndisponivel`, `NaoEncontrado`, `RecusadoPelaPlataforma(mensagem)` e `SemIntegracao`, todas `extends ErroConector` (que `extends Error` com `codigo`);
    - `traduzirErroConector(e: unknown): ErroApi`:

      | erro | status | código |
      |---|---|---|
      | `CredencialInvalida` | 422 | `CREDENCIAL_INVALIDA` ("A plataforma recusou as credenciais. Confira os dados da integração.") |
      | `LimiteDaPlataforma` | 503 | `LIMITE_DA_PLATAFORMA` |
      | `PlataformaIndisponivel` | 502 | `PLATAFORMA_INDISPONIVEL` |
      | `NaoEncontrado` | 404 | `NAO_ENCONTRADO` |
      | `RecusadoPelaPlataforma` | 422 | `RECUSADO_PELA_PLATAFORMA`, com a mensagem da plataforma |
      | `SemIntegracao` | 409 | `SEM_INTEGRACAO` ("Esta loja ainda não conectou o e-commerce. Configure em Kentro Shop > Integração.") |
      | qualquer outro | 500 | `ERRO_INTERNO` |

  - `texto.ts`:
    - `htmlParaTexto(html: string | null | undefined): string`: remove tags, `<script>` e `<style>` com o conteúdo, decodifica entidades (`&amp; &lt; &gt; &quot; &#39; &nbsp;` e `&#NNN;`), troca `<br>`/`</p>` por quebra de linha e colapsa espaços;
    - `numero(v: unknown): number | null`: aceita número, `"129.90"` e `"129,90"`; vazio, `null` ou inválido → `null`;
    - `urlHttps(v: string | null | undefined): string | null`: sem esquema → prefixa `https://`; `http://` → `https://`; vazio → `null`.

- [ ] **Passo 1: testes que falham.**
  - `htmlParaTexto('<p>Piso <b>forte</b></p><p>2&nbsp;m&sup2;&amp;</p><script>x()</script>')` → `'Piso forte\n2 m²&'`; `htmlParaTexto(null)` → `''`.
  - `numero('129.90')` → `129.9`; `numero('1.234,50')` → `1234.5`; `numero('')`, `numero(null)` e `numero('abc')` → `null`; `numero(7)` → `7`.
  - `urlHttps('loja.com/a.jpg')` → `'https://loja.com/a.jpg'`; `urlHttps('http://x/y')` → `'https://x/y'`; `urlHttps('')` → `null`.
  - `traduzirErroConector`: um caso por classe da tabela, conferindo status e código; `new Error('x')` → 500 `ERRO_INTERNO`.
- [ ] **Passo 2:** `npm test -- texto erros-conector`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: modelo de domínio e interface de conector".

---

### Tarefa 2: Tabelas da integração e `ClienteHttpConector`

**Arquivos:** `api/prisma/schema.prisma` (3 modelos), migração `*_integracao`, `conectores/nucleo/ritmo.ts`, `conectores/nucleo/cliente-http.ts`. Teste: `api/test/cliente-http.spec.ts`. Modificar `api/test/limpar.ts` para incluir as tabelas novas.

**Interfaces:**
- Produz, no Prisma:

  | modelo | campos |
  |---|---|
  | `Integracao` (`integracoes`) | `lojaId` (uuid, `@id`, FK `lojas` com `onDelete: Cascade`), `plataforma`, `credenciaisCifradas Bytes`, `iv Bytes`, `status` (`pendente \| ok \| erro`, padrão `pendente`), `ultimoTesteEm?`, `ultimoErro?`, `criadoEm`, `atualizadoEm` |
  | `ChamadaConector` (`chamadas_conector`) | `id BigInt @id @default(autoincrement())`, `lojaId` uuid, `plataforma`, `operacao`, `statusHttp Int?`, `ms Int`, `erroCodigo String?`, `em DateTime @default(now())`; `@@index([lojaId, em])` |
  | `RegraProduto` (`regras_produto`) | `lojaId` uuid, `sku`, `oculto Boolean @default(false)`, `selo String?`, `m2PorUnidade Float?`, `rendimentoM2 Float?`, `compreJunto String[] @default([])`, `atualizadoEm`; `@@id([lojaId, sku])` |

- Produz, no código:
  - `class BaldeDeFichas { constructor(porSegundo: number, rajada: number, agora?: () => number); aguardar(): Promise<void> }`: espera o tempo necessário até haver ficha (relógio injetável).
  - `class ClienteHttpConector`, criado por `criarClienteHttp(opcoes)`, com:
    - opções `{ lojaId, plataforma, ritmo: { porSegundo, rajada }, fetch?: typeof fetch, registrar: (c: ChamadaRegistrada) => Promise<void>, esperar?: (ms) => Promise<void>, timeoutMs?: number }`;
    - método `requisitar(req: { metodo: 'GET' | 'POST'; url: string; operacao: string; cabecalhos?: Record<string, string>; corpo?: unknown }): Promise<{ status: number; corpo: unknown }>`.
  - Comportamento do `requisitar`:
    - **ritmo:** um balde **por `lojaId + plataforma`**, num mapa estático;
    - **timeout:** 8 s via `AbortController`;
    - **novas tentativas:** 429 e 5xx (e erro de rede ou timeout) têm **no máximo 2** novas tentativas, com espera exponencial de 500 ms e 1000 ms, ou o `Retry-After` em segundos quando vier, limitado a 10 s;
    - **erros ao final:**

      | resposta | erro lançado |
      |---|---|
      | 401 ou 403 | `CredencialInvalida` |
      | 404 | `NaoEncontrado` |
      | 429 depois das tentativas | `LimiteDaPlataforma` |
      | 5xx, rede ou timeout depois das tentativas | `PlataformaIndisponivel` |
      | outro 4xx | `RecusadoPelaPlataforma` com a mensagem do corpo |
    - **registro:** cada tentativa chama `registrar({ lojaId, plataforma, operacao, statusHttp, ms, erroCodigo })`. O que vai para o registro é a **operação**, nunca a URL com query nem os cabeçalhos;
    - **corpo:** JSON parseado; se não for JSON, o texto.

- [ ] **Passo 1: testes que falham** (`fetch` falso e `esperar` falso, que só registra as esperas):
  - 200 com JSON → devolve o corpo parseado e registra 1 chamada com `statusHttp: 200` e `operacao`;
  - 500, 500, 200 → devolve sucesso depois de 3 chamadas; esperas `[500, 1000]`;
  - 429 com `Retry-After: 3` e depois 200 → espera `[3000]`;
  - 503 três vezes → lança `PlataformaIndisponivel`, com 3 registros;
  - 401 → lança `CredencialInvalida` **sem** nova tentativa;
  - `fetch` que nunca responde, com `timeoutMs: 50` → `PlataformaIndisponivel` depois das tentativas;
  - o registro nunca contém `?`, `Authorization` nem a URL completa;
  - `BaldeDeFichas(2, 5)` com relógio falso → 5 chamadas imediatas; a 6ª espera 500 ms.

  E em `migracoes.e2e-spec.ts`: criar `RegraProduto` duplicada (mesma loja e mesmo SKU) → `P2002`; apagar a loja apaga a sua `Integracao`.
- [ ] **Passo 2:** `npm test -- cliente-http migracoes`. Esperado: FALHA.
- [ ] **Passo 3:** escrever o schema, gerar a migração com `npm run db:local` e `npx prisma migrate dev --name integracao`, e implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: cliente HTTP dos conectores e tabelas da integração".

---

### Tarefa 3: `IntegracoesService`, `RegistroConectores` e rotas de integração

**Arquivos:** `conectores/nucleo/registro.ts`, `conectores/conectores.module.ts`, `integracoes/*`; `api/test/conectores/conector-falso.ts`. Teste: `api/test/integracoes.e2e-spec.ts`.

**Interfaces:**
- Consome: `Conector` (T1), `criarClienteHttp` (T2), `cifrar`/`decifrar`, `ChaveLojaGuard` e `@Papel` (Fase 0).
- Produz:
  - `RegistroConectores`: `listar(): Conector[]` e `obter(id: string): Conector` (lança `NaoEncontrado`). É montado a partir do token `CONECTORES` (provider com a lista de conectores). Nos testes, `criarAppDeTeste(config?, opcoes?: { conectores?: Conector[] })` ganha o 2º parâmetro e sobrescreve esse provider. O padrão nos testes é `[conectorFalso]`.
  - `conector-falso.ts`:
    - `id: 'falso'`, `camposDeCredencial: [{ chave: 'url_api', tipo: 'url', obrigatorio: true, ... }, { chave: 'token', tipo: 'segredo', obrigatorio: true, ... }]`;
    - `testarConexao` devolve `ok` só se `token === 'certo'`;
    - `listarCategorias` e `listarProdutos` devolvem dados fixos (3 produtos com SKUs `A1`, `B2` e `C3`; `C3` com 2 variações).
  - `IntegracoesService`:
    - `salvar(lojaId, plataforma, credenciais: Record<string, string>)`: valida que a plataforma existe e que os campos obrigatórios estão preenchidos (após `trim`); recusa chave não declarada com 400 `ENTRADA_INVALIDA`; cifra o JSON das credenciais; `status` volta a `pendente`;
    - `ler(lojaId): { plataforma, status, ultimoTesteEm, ultimoErro, credenciais }`, com valores de campo `segredo` trocados por `'••••'`;
    - `testar(lojaId)`: decifra, chama `testarConexao`, grava `status` `ok` ou `erro`, `ultimoTesteEm` e `ultimoErro`; com `ok`, a loja passa de `pendente_integracao` para `ativa`;
    - `contexto(lojaId): Promise<{ conector: Conector; ctx: CtxConector }>`: lança `SemIntegracao` se não houver integração.
  - Rotas, todas com `@Papel('admin')` exceto `GET /v1/conectores` (qualquer chave):

    | rota | resposta |
    |---|---|
    | `GET /v1/conectores` | `[{ id, nome, capacidades, camposDeCredencial }]` |
    | `GET /v1/loja/integracao` | o `ler()` acima, ou 404 `NAO_ENCONTRADO` se ainda não existe |
    | `PUT /v1/loja/integracao` | corpo `{ plataforma: string; credenciais: Record<string, string> }`. Reenviar `'••••'` num campo segredo **mantém** o valor gravado. |
    | `POST /v1/loja/integracao/testar` | `{ ok: true, nomeLoja? }` ou `{ ok: false, mensagem }` (sempre 200) |

- [ ] **Passo 1: testes que falham** (app com o conector falso):
  - `GET /v1/conectores` com a chave de atendimento lista `falso` com os campos;
  - `PUT` com `token: ' certo \n'` → 200; o `GET` mostra `token: '••••'` e `url_api` em claro; a linha no banco não contém `certo` em `JSON.stringify` (Foco 1);
  - `PUT` sem `url_api` → 400; com `extra: 'x'` → 400; com plataforma `nao-existe` → 404;
  - `PUT` reenviando `token: '••••'` → mantém o segredo: o teste seguinte dá `ok: true`;
  - `testar` com o token certo → `{ ok: true }`, a loja vira `ativa` e o `GET` mostra `status: 'ok'`; com o token errado → `{ ok: false, mensagem }` e `status: 'erro'`;
  - chave de atendimento em `PUT`/`testar` → 403 `PERMISSAO_NEGADA`;
  - isolamento: a loja B não lê a integração da loja A (404).
- [ ] **Passo 2:** `npm test -- integracoes`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: integração da loja com credenciais cifradas".

---

### Tarefa 4: Gravar respostas reais da eCommerce-net (depende do usuário)

**Arquivos:** criar `scripts/gravar-fixtures-ecommercenet.mjs` e `api/src/conectores/ecommercenet/fixtures/` (gerada pelo script).

**O script:**
- **Entrada:** variáveis de ambiente `ECN_URL` (endereço base da API da loja), `ECN_CLIENT_ID` e `ECN_CLIENT_SECRET`. **As credenciais nunca vão para arquivo nem para o chat.**
- **Autenticação:** testa os dois formatos de `Authorization`, primeiro o base64 puro de `id:secret` e depois `Basic <base64>`. Imprime qual funcionou e grava isso em `fixtures/_formato.json` (`{ "authorization": "puro" | "basic" }`).
- **O que grava:**
  - `category/findbyname` sem nome → `categorias.json`;
  - `product/all?page=1&limit=24` → `produtos-p1.json`;
  - `product/all?page=2&limit=24` → `produtos-p2.json`;
  - `product/all` com `search` de uma palavra que exista → `busca.json`;
  - `product/all` com `search=zzzzzz` → `busca-vazia.json`;
  - `product/findBySku` de um produto **simples** e de um **com variação** → `produto-simples.json` e `produto-variacao.json`;
  - `product/findvarietybyproductskuv2` do produto com variação → `variacoes.json`;
  - `product/findbuyitwithbysku` → `compre-junto.json`;
  - `product/findRelatedBySku` → `relacionados.json`;
  - uma chamada com credencial errada → `credencial-invalida.json` (status e corpo).
- **Saída:** cada arquivo é `{ status, corpo }`, sem cabeçalhos. No fim, imprime um resumo (quantos produtos, se houve variação, nomes dos campos de imagem encontrados).

- [ ] **Passo 1:** escrever o script (sem teste automatizado: é ferramenta de gravação).
- [ ] **Passo 2: usuário** roda o script, na própria máquina:
  ```
  ECN_URL=... ECN_CLIENT_ID=... ECN_CLIENT_SECRET=... node scripts/gravar-fixtures-ecommercenet.mjs
  ```
  Esperado: os 13 arquivos gravados e o formato de autenticação detectado.
- [ ] **Passo 3:** ler as fixtures e **registrar no plano** o formato real dos campos usados pela Tarefa 5 (imagem, unidade, categoria, variação), corrigindo os nomes de campo da Tarefa 5 se divergirem do OpenAPI.
- **Se o usuário ainda não tiver credenciais:** a Tarefa 5 segue com fixtures **sintéticas**, montadas a partir dos exemplos do OpenAPI e de `shopping_dos_pisos/src/catalogo/dados/catalogo.json`, com `"_sintetico": true`. A bateria de contrato marca isso em aviso, e o conector só vai para cliente real depois da gravação.
- [ ] **Passo 4: Ponto de commit:** "test: respostas gravadas da eCommerce-net".

---

### Tarefa 5: Conector eCommerce-net e bateria de contrato

**Arquivos:** `conectores/ecommercenet/ecommercenet.conector.ts` e `normalizar.ts`; registrar no `conectores.module.ts`. Testes: `api/test/conectores/contrato.spec.ts` e `api/test/conectores/ecommercenet.spec.ts`.

**Interfaces:**
- Consome: `ClienteHttpConector` (T2), `htmlParaTexto`/`numero`/`urlHttps` (T1) e as fixtures (T4).
- Produz:
  - `id: 'ecommercenet'`, `nome: 'eCommerce-net'`.
  - `camposDeCredencial`:
    - `url_api` (url, obrigatório, ajuda: "Endereço da API da sua loja, informado no painel da eCommerce-net em API.");
    - `client_id` (texto, obrigatório);
    - `client_secret` (segredo, obrigatório).
  - `capacidades`: `{ buscaTextual: true, categorias: true, variacoes: true, estoque: true, relacionados: true, cotarFrete: false, criarPedido: false, oauth: false }`. Frete e pedido ficam para a Fase 2.
  - **Autenticação:** cabeçalho `Authorization` no formato que a Tarefa 4 detectou.
  - **Toda resposta com `success: false`** → `RecusadoPelaPlataforma` com o primeiro item de `errors` (Foco 3).
  - Métodos:
    - `testarConexao`: `product/all?page=1&limit=1`;
    - `listarCategorias`: `category/findbyname` sem nome;
    - `listarProdutos({ busca, categoriaId, pagina, porPagina })`: `product/all` com `page`, `limit` (no máximo 200), `search` e `category_id`; `temMais = page < pages`;
    - `obterProduto(id)`: `product/findBySku`, mais `findvarietybyproductskuv2` quando o produto tem variação; `null` se der `NaoEncontrado`;
    - `relacionados(id)`: `findbuyitwithbysku` e `findRelatedBySku`, concatenados e sem SKU repetido.
  - **`normalizar.ts`:**
    - `produtoDeEcn(raw): Produto`:
      - números via `numero()`;
      - `promotional_price` `null`, `0` ou maior ou igual a `price` → sem promoção: `preco = price` e `precoDe` ausente;
      - com promoção válida: `preco = promotional_price` e `precoDe = price` (Foco 2);
      - `disponivel = status == 1 && (estoque === null || estoque > 0)`;
      - imagens via `urlHttps` (campo `product_images`, ou o que a Tarefa 4 encontrar);
      - descrição via `htmlParaTexto`;
      - `unidade = unit_measurement || 'UN'`;
    - `variacaoDeEcn(raw): Variacao`;
    - `categoriaDeEcn(raw): Categoria`.
  - **Bateria de contrato:** `contrato.spec.ts` exporta `rodarContrato(nome, fabricar: (http) => Conector, fixtures)` e roda para `falso` e `ecommercenet`, checando:
    - produto normalizado com tipos corretos (preço `number` e maior que 0, imagens começando com `https://`, `descricao` sem `<`);
    - paginação (`temMais` coerente com a 2ª página);
    - produto com e sem variação;
    - busca vazia → `itens: []`;
    - credencial inválida → `CredencialInvalida`;
    - 429 seguido de 200 → sucesso;
    - para cada capacidade `true`, o método correspondente existe (e vice-versa).

- [ ] **Passo 1: testes que falham.** A bateria acima, mais em `ecommercenet.spec.ts`:
  - `"0.00"` em `promotional_price` → sem `precoDe`;
  - `success: false` com `errors: ['Token inválido']` → `RecusadoPelaPlataforma('Token inválido')`;
  - imagem sem esquema vira `https://...`;
  - `limit` nunca passa de 200, mesmo com `porPagina: 500`;
  - o cabeçalho `Authorization` enviado segue o formato de `_formato.json`.
- [ ] **Passo 2:** `npm test -- conectores`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: conector eCommerce-net com bateria de contrato".

---

### Tarefa 6: Regras por SKU, `CatalogoService` e rota de prévia

**Arquivos:** `regras/*`, `catalogo/catalogo.service.ts`, `catalogo/catalogo.controller.ts`. Testes: `api/test/regras.e2e-spec.ts` e `api/test/catalogo.e2e-spec.ts`.

**Interfaces:**
- Consome: `IntegracoesService.contexto` (T3) e `PrismaService`.
- Produz:
  - **Rotas de regras** (`@Papel('admin')`):
    - `GET /v1/loja/regras` → lista as regras da loja;
    - `GET /v1/loja/regras/:sku`, ou 404;
    - `PUT /v1/loja/regras/:sku` com `{ oculto?, selo? (≤ 30 caracteres), m2PorUnidade? (> 0), rendimentoM2? (> 0), compreJunto? (≤ 20 SKUs) }` (upsert);
    - `DELETE /v1/loja/regras/:sku` → 204.
  - **`CatalogoService`:**
    - `listarCategorias(lojaId)`: tira as `categorias_ocultas` quando a 1.3 existir (por ora, todas);
    - `listarProdutos(lojaId, filtro)`: chama o conector e aplica as regras por SKU; produto `oculto` sai da lista, e `selo`, `m2PorUnidade`, `rendimentoM2` e `compreJunto` são anexados no campo `regras?: { selo?, m2PorUnidade?, rendimentoM2?, compreJunto: string[] }` do `Produto`. **Este campo extra deve ser acrescentado ao modelo da Tarefa 1** como opcional;
    - `obterProduto(lojaId, id)`: mesmo tratamento, mais `compreJunto` = SKUs da regra + `relacionados()` nativo, sem repetição e com a regra primeiro;
    - **lê as regras numa única consulta por página** (`sku IN (...)`), nunca uma consulta por produto.
  - **`GET /v1/loja/catalogo/produtos?busca&categoria&pagina`** (qualquer chave): devolve `Pagina<Produto>` com 24 por página. Serve para a prévia da aba Integração agora e para o painel na 1.2.
  - Erros do conector passam por `traduzirErroConector` (Foco 4 e Foco 5).

- [ ] **Passo 1: testes que falham** (conector falso):
  - regra `oculto` em `B2` → a lista volta só com `A1` e `C3`;
  - `selo: 'Mais vendido'` em `A1` aparece em `regras.selo`;
  - `compreJunto: ['C3']` em `A1` aparece primeiro no `obterProduto`;
  - loja sem integração → 409 `SEM_INTEGRACAO` (Foco 4);
  - conector que lança `PlataformaIndisponivel` → 502 `PLATAFORMA_INDISPONIVEL` (Foco 5);
  - `PUT` de regra com a chave de atendimento → 403;
  - isolamento: a regra da loja A não afeta a lista da loja B;
  - 1 consulta de regras por listagem (espiando o `prisma.regraProduto.findMany`).
- [ ] **Passo 2:** `npm test -- regras catalogo`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: regras por SKU e catálogo ao vivo".

---

### Tarefa 7: Aba Integração na extensão Admin e publicação

**Arquivos:** modificar `extension/admin/config.html`. Testes: `api/test/config-admin-integracao.spec.ts` e os testes existentes de `config-admin.spec.ts`, que continuam passando.

**Interfaces:**
- Consome: `GET /v1/conectores`, `GET/PUT /v1/loja/integracao`, `POST /v1/loja/integracao/testar` e `GET /v1/loja/catalogo/produtos` (T3 e T6).
- Produz, na tela de Configurações (com a chave de admin válida):
  - **Abas:** `#aba-integracao` agora; as outras entram nos planos seguintes.
  - **Formulário:**
    - `#plataforma` (select vindo de `GET /v1/conectores`);
    - campos gerados por `camposDeCredencial`: `input` com `id="campo-<chave>"`, `type="password"` para segredo e `type="url"` para url;
    - campos já gravados vêm do `GET` (segredo mostra `••••`).
  - **Botões:**
    - `#btn-salvar-integracao` → `PUT`;
    - `#btn-testar` → `POST testar`, mostrando em `#resultado-teste` "Conexão funcionando: {nomeLoja ou nome da plataforma}." ou "A conexão falhou: {mensagem}".
  - **Com o teste ok:** `#capacidades` lista as capacidades `true` em português (Busca, Categorias, Variações, Estoque, Produtos relacionados), e `#previa` mostra os 5 primeiros produtos (nome e preço em `pt-BR`) de `GET /v1/loja/catalogo/produtos`.
  - **Status do topo:** passa a mostrar "Loja {nome} · Integração: {pendente | funcionando | com erro}".

- [ ] **Passo 1: testes que falham** (`omni` simulado):
  - o formulário gera os 3 campos da eCommerce-net, com `client_secret` como `type=password`;
  - salvar envia `PUT` com `{ plataforma: 'ecommercenet', credenciais: { url_api, client_id, client_secret } }`, com valores aparados;
  - um segredo não alterado é reenviado como `••••`;
  - teste ok → mensagem de sucesso, capacidades e prévia com 5 itens;
  - teste com falha → "A conexão falhou: …";
  - `SEM_INTEGRACAO` na prévia não quebra a tela.
- [ ] **Passo 2:** `npm test -- config-admin`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test` e `npm run build`. Esperado: PASSA.
- [ ] **Passo 5: publicar:**
  - (com o MCP "Kentro teste" carregado) clonar a versão 0.1.0 do `mateus.kentroshop-admin` (editor 20), gravar o `config.html` novo, `version` `0.2.0`, publicar e mover o ponteiro de **dev** primeiro;
  - **usuário** faz o deploy da API no Doca;
  - testar na instância e depois mover o ponteiro de **prod**.
- [ ] **Passo 6: verificação real com o usuário:** colar as credenciais da eCommerce-net na aba Integração, testar a conexão e ver a prévia com produtos reais.
- [ ] **Passo 7: Ponto de commit:** "feat: aba Integração na extensão Admin".

**Aceite da Fase 1.1:** o admin conecta a eCommerce-net pela tela, o teste de conexão passa, a prévia mostra produtos reais normalizados (preço em número, imagem https, sem HTML), a loja vira `ativa`, e a bateria de contrato passa com as respostas gravadas.
