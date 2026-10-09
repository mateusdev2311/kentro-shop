# Kentro Shop — Fase 0 (Fundação) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** monorepo com API NestJS + Postgres (Prisma) que registra lojas, guarda segredos com segurança, autentica as duas extensões (Admin e Atendimento) e o superadmin, e serve os manifests das duas extensões com CORS, pronto para deploy na VPS.

**Arquitetura:** um repositório com workspaces npm (`api`, `storefront`). O build da raiz gera um único `dist/` na raiz (`main.js`, `public/`, `extensao/`, `prisma/`), igual à demo, que já funcionou na VPS. A própria API serve as duas extensões em `/extensao/<atendimento|admin>/…` com `Access-Control-Allow-Origin: *`, o que é o plano B da seção 4.3 da spec, promovido a caminho principal por ser testável localmente. As migrações rodam no boot.

**Tecnologias:** Node 22, TypeScript 5, NestJS 10 (mesma versão da demo), Prisma 6, `@nestjs/throttler` 6, `class-validator`, Jest + ts-jest + supertest, `embedded-postgres` (Postgres real nos testes, sem Docker), jsdom (testes das extensões), Vite + Preact (placeholder do catálogo).

**Spec:** `docs/superpowers/specs/2026-10-07-kentro-shop-design.md` (seções 4, 8, 10.0–10.2, 12, 13, 14 e 16 — Fase 0).

## Restrições globais
- **Não fazer commits nem `git init`.** O usuário faz os commits. Onde a skill pediria commit, o passo é "Ponto de commit", e você só avisa o que mudou.
- Código, nomes, mensagens e textos de interface em **português do Brasil**, como na spec.
- Erro padrão da API: `{ "erro": { "codigo": "CODIGO_EM_MAIUSCULAS", "mensagem": "texto em português" } }`.
- Prefixo das rotas: `/v1` (exceto `GET /`, `/c/:token` e `/extensao/...`).
- Segredos (`chave_admin`, `chave_atendimento`, token MCP): 32 bytes aleatórios, mostrados uma vez, guardados **só** como SHA-256 em hexadecimal.
- Credenciais cifradas com **AES-256-GCM**, IV por registro, chave mestra em `CHAVE_MESTRA_CRIPTO` (base64 de exatamente 32 bytes).
- Nunca logar segredos nem dados pessoais. Nenhum segredo em código ou documento.
- `npm run build` na raiz gera `dist/main.js`. A VPS só leva a pasta `dist/` (mais o `node_modules` da raiz).
- Variáveis de ambiente obrigatórias em produção: `DATABASE_URL`, `CHAVE_MESTRA_CRIPTO`, `TOKEN_SUPERADMIN`, `URL_PUBLICA`. Opcional: `PORTA` (padrão 3000).

## Desvios da spec decididos neste plano (atualizar a spec na Tarefa 9)
1. **npm workspaces em vez de pnpm:** o pnpm não está instalado e a VPS usa `npm run build`.
2. **Projeto da VPS aponta para a raiz do repositório** (não para `api/`): o build precisa do `storefront/` e do `extension/`, que ficam fora de `api/`.
3. **A API serve as extensões** (plano B da seção 4.3). Assim não há um segundo projeto "Extensão" na VPS e o CORS é garantido por código e por teste.
4. **`packages/contratos` fica para a Fase 1:** a Fase 0 não usa o modelo de produto (YAGNI).
5. **`GET /v1/loja` aceita as duas chaves** e devolve o `papel`, para o painel do atendimento mostrar "conectado".
6. **Só a tabela `lojas` na Fase 0.** As demais tabelas da seção 12 entram, cada uma com a sua migração, na fase que as usa.

## Foco de revisão
1. **Chave colada com espaço ou quebra de linha** (o admin copia e cola) → a API aceita a chave após `trim()`. Teste na Tarefa 4.
2. **`api_url` salvo com barra no final** (`https://x.com/`) → as extensões removem as barras finais antes de montar a URL. Teste na Tarefa 7.
3. **Variável de ambiente ausente ou `CHAVE_MESTRA_CRIPTO` com tamanho errado** → o boot falha com mensagem listando o que falta, em vez de subir e quebrar depois. Teste na Tarefa 1.
4. **Caminho malicioso ou arquivo inexistente em `/extensao/...`** (`..`, `%2e%2e`, extensão desconhecida) → 404, sem ler nada fora da pasta. Teste na Tarefa 6.
5. **Corpo JSON inválido ou campo extra no registro** → 400 `ENTRADA_INVALIDA`, nunca 500. Teste na Tarefa 4.

---

## Estrutura de arquivos

```
kentro-shop/
  package.json            workspaces ["api", "storefront"]; scripts build, test, db:local
  .gitignore              node_modules, dist, .env, api/.db-local
  api/
    package.json  tsconfig.json  tsconfig.build.json  jest.config.js
    prisma/schema.prisma  prisma/migrations/<data>_inicial/migration.sql
    scripts/db-local.ts   Postgres embutido para desenvolvimento (porta 54329)
    src/
      main.ts                     boot: lê config, aplica migrações, sobe o Nest
      app.module.ts
      comum/config.ts             lerConfig(env) → ConfigApp
      comum/erros.ts              ErroApi + FiltroDeErros (formato padrão)
      comum/cripto.ts             cifrar/decifrar AES-256-GCM, gerarSegredo, hashSegredo
      comum/prisma.service.ts     PrismaService
      comum/migracoes.ts          aplicarMigracoes(databaseUrl, schemaPath)
      saude/saude.controller.ts   GET /
      lojas/lojas.module.ts  lojas.controller.ts  lojas.service.ts  dto.ts
      lojas/chave-loja.guard.ts   ChaveLojaGuard + @Papel()
      admin/admin.module.ts  admin.controller.ts  superadmin.guard.ts
      extensao/extensao.controller.ts   GET/OPTIONS /extensao/:ext/:arquivo
      catalogo/catalogo-pagina.controller.ts   GET /c/:token (placeholder)
    test/
      banco.ts  global-setup.ts  global-teardown.ts  app.ts (criarAppDeTeste)
      config.spec.ts  cripto.spec.ts  migracoes.e2e-spec.ts  saude.e2e-spec.ts
      lojas.e2e-spec.ts  admin.e2e-spec.ts  extensao.e2e-spec.ts
      manifests.spec.ts  painel.spec.ts  config-admin.spec.ts  catalogo-pagina.e2e-spec.ts
  storefront/
    package.json  vite.config.ts  tsconfig.json  index.html  src/main.tsx
  extension/
    atendimento/manifest.json  atendimento/painel.html
    admin/manifest.json        admin/config.html
```

---

### Tarefa 1: Monorepo, esqueleto da API, config e formato de erro

**Arquivos:**
- Criar: `package.json`, `.gitignore`, `api/package.json`, `api/tsconfig.json`, `api/tsconfig.build.json`, `api/jest.config.js`, `api/src/main.ts`, `api/src/app.module.ts`, `api/src/comum/config.ts`, `api/src/comum/erros.ts`, `api/src/saude/saude.controller.ts`
- Teste: `api/test/config.spec.ts`, `api/test/saude.e2e-spec.ts`, `api/test/app.ts`

**Interfaces:**
- Produz:
  - `interface ConfigApp { porta: number; databaseUrl: string; chaveMestra: Buffer; tokenSuperadmin: string; urlPublica: string; dirExtensao: string; dirPublic: string }`
  - `lerConfig(env: NodeJS.ProcessEnv): ConfigApp`: lança `Error` cuja mensagem lista **todas** as variáveis ausentes de uma vez. `urlPublica` sai sem barras finais. Por padrão, `dirExtensao = path.join(__dirname, '..', 'extensao')` e `dirPublic = path.join(__dirname, '..', 'public')` (no `dist/`), sobrescrevíveis por `DIR_EXTENSAO` e `DIR_PUBLIC`.
  - Token de injeção `CONFIG_APP` (provider global com o `ConfigApp`).
  - `class ErroApi extends HttpException { constructor(status: number, codigo: string, mensagem: string) }`
  - `FiltroDeErros` global:
    - `ErroApi` → corpo padrão;
    - erro do `ValidationPipe` → 400 `ENTRADA_INVALIDA`;
    - JSON malformado → 400 `ENTRADA_INVALIDA`;
    - 404 do Nest → `NAO_ENCONTRADO`;
    - 429 do throttler → `LIMITE_DE_REQUISICOES`;
    - qualquer outro → 500 `ERRO_INTERNO`, com a mensagem "Erro interno. Tente de novo em instantes." e o erro logado sem dados da requisição.
  - `configurarApp(app: INestApplication): void`: aplica `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, `FiltroDeErros` e `set('trust proxy', 1)`. É usada pelo `main.ts` e pelos testes.
  - `criarAppDeTeste(sobrescrever?: Partial<ConfigApp>): Promise<INestApplication>` em `test/app.ts`.

Raiz `package.json`: `"private": true`, `"workspaces": ["api", "storefront"]`, `"engines": { "node": ">=20" }`; scripts `test` (`npm test -w api`) e `db:local` (`npm run db:local -w api`). O script `build` entra na Tarefa 8. `api/package.json` usa NestJS `^10.4` (mesma versão da demo), `reflect-metadata`, `rxjs`, `class-validator`, `class-transformer`; Jest com `testRegex: '.*\\.(e2e-)?spec\\.ts$'`. O `tsconfig.build.json` da API compila `src` para `../dist` (raiz).

- [ ] **Passo 1: Escrever os testes que falham**

`config.spec.ts`:
- `lerConfig({})` lança um erro cuja mensagem contém `DATABASE_URL`, `CHAVE_MESTRA_CRIPTO`, `TOKEN_SUPERADMIN` e `URL_PUBLICA`;
- com `CHAVE_MESTRA_CRIPTO` = base64 de 16 bytes, lança erro contendo `"32 bytes"`;
- com `URL_PUBLICA: 'https://shop.exemplo.com//'`, retorna `urlPublica === 'https://shop.exemplo.com'`;
- `porta` padrão `3000` e `PORTA: '8080'` → `8080`.

`saude.e2e-spec.ts` (usa `criarAppDeTeste`):
- `GET /` → 200 `{ ok: true }`;
- `GET /nao-existe` → 404 e `body.erro.codigo === 'NAO_ENCONTRADO'`.

Até a Tarefa 2, o `criarAppDeTeste` monta só o Nest, sem banco.

- [ ] **Passo 2:** `npm install` na raiz e depois `npm test`. Esperado: FALHA (módulos inexistentes).
- [ ] **Passo 3:** implementar os arquivos acima.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA (6 testes).
- [ ] **Passo 5: Ponto de commit:** "chore: monorepo e esqueleto da API".

---

### Tarefa 2: Prisma, tabela `lojas`, migrações no boot e Postgres de teste

**Arquivos:**
- Criar: `api/prisma/schema.prisma`, `api/prisma/migrations/*_inicial/migration.sql` (gerada), `api/scripts/db-local.ts`, `api/src/comum/prisma.service.ts`, `api/src/comum/migracoes.ts`, `api/test/banco.ts`, `api/test/global-setup.ts`, `api/test/global-teardown.ts`
- Modificar: `api/src/main.ts`, `api/src/app.module.ts`, `api/test/app.ts`, `api/jest.config.js`, `api/package.json`
- Teste: `api/test/migracoes.e2e-spec.ts`

**Interfaces:**
- Produz:
  - Modelo `Loja` (`@@map("lojas")`):

    | campo | tipo | coluna / detalhe |
    |---|---|---|
    | `id` | `String @id @default(uuid()) @db.Uuid` | |
    | `nome` | `String?` | |
    | `chaveAdminHash` | `String @unique` | `chave_admin_hash` |
    | `chaveAtendimentoHash` | `String @unique` | `chave_atendimento_hash` |
    | `tokenMcpHash` | `String @unique` | `token_mcp_hash` |
    | `status` | `StatusLoja @default(pendente_integracao)` | enum `pendente_integracao \| ativa \| bloqueada` |
    | `plano` | `String @default("gratis")` | |
    | `limites` | `Json @default("{}")` | |
    | `criadoEm` | `DateTime @default(now())` | `criado_em` |
    | `atualizadoEm` | `DateTime @updatedAt` | `atualizado_em` |

  - `PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy`, num `ComumModule` global.
  - `aplicarMigracoes(databaseUrl: string, schemaPath: string): void`: roda `prisma migrate deploy --schema <schemaPath>` com `execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), ...], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' })`. `prisma` vai em **dependencies** (roda em produção).
  - `main.ts`: `lerConfig` → `aplicarMigracoes(config.databaseUrl, path.join(__dirname, 'prisma', 'schema.prisma'))` → `NestFactory.create` → `configurarApp` → `listen(config.porta)`.
  - `test/banco.ts`:
    - `iniciarBanco(porta: number): Promise<{ url: string; parar(): Promise<void> }>`: usa `embedded-postgres` com `databaseDir` em `os.tmpdir()` e usuário/senha `kentro`/`kentro`; cria o banco `kentro_shop_teste`.
    - `limparBanco(prisma: PrismaClient): Promise<void>`: `TRUNCATE lojas CASCADE`.
  - `global-setup.ts`: sobe o banco na porta 54330, roda `aplicarMigracoes(url, 'prisma/schema.prisma')` e grava a url em `process.env.DATABASE_URL`. O script `test` da API é `jest --runInBand`: um banco só, testes em série, e a `DATABASE_URL` definida no global-setup fica visível para os testes.
  - `scripts/db-local.ts` (`npm run db:local`): Postgres embutido na porta 54329, pasta `api/.db-local`; imprime a `DATABASE_URL` e fica rodando. É usado para `prisma migrate dev`.

- [ ] **Passo 1: Escrever o teste que falha.** `migracoes.e2e-spec.ts`:
  - `prisma.loja.create({ data: { chaveAdminHash: 'a', chaveAtendimentoHash: 'b', tokenMcpHash: 'c' } })` devolve `status === 'pendente_integracao'`, `plano === 'gratis'` e `limites` igual a `{}`;
  - criar uma segunda loja com o mesmo `chaveAdminHash` rejeita com o código Prisma `P2002`.
- [ ] **Passo 2:** `npm test`. Esperado: FALHA (sem schema e sem banco).
- [ ] **Passo 3:** escrever o `schema.prisma`, subir `npm run db:local` em outro terminal e gerar a migração com `npx prisma migrate dev --name inicial` (em `api/`, com a `DATABASE_URL` impressa). Implementar o resto.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA (testes das Tarefas 1 e 2).
- [ ] **Passo 5: Ponto de commit:** "feat: Prisma, tabela lojas e migrações no boot".

---

### Tarefa 3: Criptografia e segredos

**Arquivos:**
- Criar: `api/src/comum/cripto.ts`
- Teste: `api/test/cripto.spec.ts`

**Interfaces:**
- Produz:
  - `cifrar(texto: string, chaveMestra: Buffer): { cifrado: Buffer; iv: Buffer }`: AES-256-GCM, IV aleatório de 12 bytes, tag de 16 bytes **anexada ao fim** de `cifrado`.
  - `decifrar(cifrado: Buffer, iv: Buffer, chaveMestra: Buffer): string`: lança se a tag não confere.
  - `gerarSegredo(tipo: 'admin' | 'atendimento' | 'mcp'): string`: prefixos `ksa_`, `ksk_` e `ksm_` + `randomBytes(32).toString('base64url')`.
  - `hashSegredo(segredo: string): string`: SHA-256 em hexadecimal de `segredo.trim()`.
  - `compararSeguro(a: string, b: string): boolean`: `timingSafeEqual` sobre os hashes SHA-256 dos dois (tamanho fixo).

- [ ] **Passo 1: Escrever os testes que falham.** `cripto.spec.ts`:
  - `decifrar(cifrar('segredo-123', k))` devolve `'segredo-123'`;
  - duas cifragens do mesmo texto têm `iv` diferentes;
  - alterar 1 byte de `cifrado` faz `decifrar` lançar;
  - decifrar com outra chave de 32 bytes lança;
  - `gerarSegredo('admin')` casa com `/^ksa_[A-Za-z0-9_-]{43}$/` (e `ksk_`/`ksm_` para os outros tipos), e duas chamadas diferem;
  - `hashSegredo(' x \n') === hashSegredo('x')`, e o resultado tem 64 caracteres hexadecimais;
  - `compararSeguro('abc', 'abc')` é `true`, e `compararSeguro('abc', 'abd')` e `compararSeguro('abc', 'abcd')` são `false`.
- [ ] **Passo 2:** `npm test -- cripto`. Esperado: FALHA.
- [ ] **Passo 3:** implementar com `node:crypto`.
- [ ] **Passo 4:** `npm test -- cripto`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: criptografia AES-256-GCM e segredos".

---

### Tarefa 4: Registro de loja, `ChaveLojaGuard`, `GET /v1/loja` e rotações

**Arquivos:**
- Criar: `api/src/lojas/lojas.module.ts`, `lojas.controller.ts`, `lojas.service.ts`, `dto.ts`, `chave-loja.guard.ts`
- Modificar: `api/src/app.module.ts` (importar `LojasModule` e `ThrottlerModule`)
- Teste: `api/test/lojas.e2e-spec.ts`

**Interfaces:**
- Consome: `PrismaService`, `gerarSegredo`, `hashSegredo`, `ErroApi`.
- Produz:
  - `POST /v1/lojas/registrar`, corpo `RegistrarLojaDto { nome?: string }` (`@IsOptional @IsString @Length(1,120)`): resposta 201 `{ lojaId, chaveAdmin, chaveAtendimento, tokenMcp }`. Throttle de **5 por hora por IP** (`@Throttle({ padrao: { limit: 5, ttl: 3_600_000 } })`), só nesta rota.
  - `ChaveLojaGuard` + decorator `@Papel('admin' | 'atendimento')`. O guard:
    1. lê `X-Loja-Chave` e aplica `trim()`;
    2. busca a loja por `chaveAdminHash` (papel `admin`) ou por `chaveAtendimentoHash` (papel `atendimento`);
    3. responde 401 `CHAVE_INVALIDA` ("Chave do Kentro Shop inválida. Confira a configuração da extensão.") se a chave faltar ou não for encontrada;
    4. responde 403 `LOJA_BLOQUEADA` se `status === 'bloqueada'`;
    5. responde 403 `PERMISSAO_NEGADA` se a rota pede `admin` e o papel é `atendimento` (a chave admin satisfaz as duas);
    6. grava em `req.loja` e `req.papel`.
  - `GET /v1/loja` (`@Papel('atendimento')`): `{ id, nome, status, plano, papel }`.
  - `POST /v1/loja/chave-admin/rotacionar`, `POST /v1/loja/chave-atendimento/rotacionar` e `POST /v1/loja/token-mcp/rotacionar` (`@Papel('admin')`): resposta 200 `{ chave }`. O hash antigo é substituído na hora.
  - `LojasService.registrar(nome?: string)`, `.rotacionar(lojaId: string, tipo: 'admin' | 'atendimento' | 'mcp')` e `.buscarPorChave(chave: string): Promise<{ loja: Loja; papel: 'admin' | 'atendimento' } | null>`.

- [ ] **Passo 1: Escrever os testes que falham.** `lojas.e2e-spec.ts` (`limparBanco` no `beforeEach`):
  - registrar `{ nome: 'Loja Teste' }` → 201; as três chaves têm os prefixos `ksa_`, `ksk_` e `ksm_` e são diferentes;
  - a linha gravada no banco não contém nenhuma das três chaves em claro: `JSON.stringify(row)` não inclui nenhuma delas;
  - `GET /v1/loja` com `chaveAdmin` → `papel: 'admin'` e `nome: 'Loja Teste'`; com `chaveAtendimento` → `papel: 'atendimento'`;
  - com a chave entre espaços e `\n` → 200 (Foco 1);
  - sem cabeçalho → 401 `CHAVE_INVALIDA`; com `ksa_inexistente` → 401 `CHAVE_INVALIDA`;
  - `chaveAtendimento` em `POST /v1/loja/chave-admin/rotacionar` → 403 `PERMISSAO_NEGADA`;
  - rotacionar a chave admin → a antiga passa a dar 401 e a nova dá 200;
  - loja A e loja B registradas: a chave de A em `GET /v1/loja` devolve o `id` de A;
  - loja com `status` posto em `bloqueada` via Prisma → 403 `LOJA_BLOQUEADA`;
  - registrar com `{ nome: 'x', extra: 1 }` → 400 `ENTRADA_INVALIDA`; corpo `'{nome:'` com `Content-Type: application/json` → 400 `ENTRADA_INVALIDA` (Foco 5);
  - 6 registros seguidos do mesmo IP → o 6º dá 429 `LIMITE_DE_REQUISICOES`.

  Para que o throttle de um teste não afete os outros, cada `describe` cria o seu próprio app.
- [ ] **Passo 2:** `npm test -- lojas`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA (todos).
- [ ] **Passo 5: Ponto de commit:** "feat: registro de loja, chaves e guard".

---

### Tarefa 5: Rotas de superadmin

**Arquivos:**
- Criar: `api/src/admin/admin.module.ts`, `admin.controller.ts`, `superadmin.guard.ts`
- Teste: `api/test/admin.e2e-spec.ts`

**Interfaces:**
- Consome: `CONFIG_APP.tokenSuperadmin`, `compararSeguro`, `PrismaService`.
- Produz:
  - `SuperadminGuard`: exige `Authorization: Bearer <TOKEN_SUPERADMIN>` e compara com `compararSeguro`. Se falhar, 401 `NAO_AUTORIZADO`.
  - `GET /v1/admin/lojas`: `[{ id, nome, status, plano, limites, criadoEm }]`, ordenado por `criadoEm` decrescente, **sem nenhum campo `*Hash`**.
  - `PATCH /v1/admin/lojas/:id`, corpo `{ status?: 'pendente_integracao' | 'ativa' | 'bloqueada'; plano?: string; limites?: object }`: devolve a loja no mesmo formato. Id inexistente ou que não é UUID → 404 `NAO_ENCONTRADO`.

- [ ] **Passo 1: Escrever os testes que falham.** `admin.e2e-spec.ts` (token de teste `'super-teste'`):
  - sem `Authorization` → 401; com `Bearer errado` → 401;
  - a lista contém a loja registrada e nenhuma chave de objeto termina em `Hash`;
  - `PATCH { status: 'bloqueada' }` → 200, e em seguida `GET /v1/loja` com a chave dessa loja → 403 `LOJA_BLOQUEADA`;
  - `PATCH { status: 'congelada' }` → 400 `ENTRADA_INVALIDA`;
  - `PATCH` em um UUID aleatório → 404 `NAO_ENCONTRADO`.
- [ ] **Passo 2:** `npm test -- admin`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: rotas de superadmin".

---

### Tarefa 6: Manifests e serviço das extensões com CORS

**Arquivos:**
- Criar: `extension/atendimento/manifest.json`, `extension/admin/manifest.json`, `api/src/extensao/extensao.controller.ts`; `painel.html` e `config.html` mínimos (só um `<p>`; o conteúdo vem na Tarefa 7)
- Teste: `api/test/manifests.spec.ts`, `api/test/extensao.e2e-spec.ts`

**Interfaces:**
- Consome: `CONFIG_APP.dirExtensao` e `CONFIG_APP.urlPublica`. Nos testes, `dirExtensao = <raiz>/extension`.
- Produz:
  - Manifests iguais aos da spec 10.1, com `"default": "__URL_PUBLICA__"` em `api_url` e `version` `"0.1.0"`.
  - `GET /extensao/:ext/:arquivo`:
    - `ext` em `['atendimento', 'admin']`;
    - `arquivo` precisa casar com `/^[a-z0-9-]+\.(html|json|js|css|svg|png)$/`, senão 404 `NAO_ENCONTRADO`;
    - `manifest.json` é servido com `__URL_PUBLICA__` substituído por `urlPublica`;
    - cabeçalhos em toda resposta: `Access-Control-Allow-Origin: *`, `Cache-Control: no-cache` e `Content-Type` pelo tipo do arquivo (`application/json; charset=utf-8`, `text/html; charset=utf-8`, `text/javascript; charset=utf-8`, `text/css; charset=utf-8`, `image/svg+xml`, `image/png`).
  - `OPTIONS /extensao/:ext/:arquivo`: 204 com `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS` e `Access-Control-Allow-Headers: *`.

- [ ] **Passo 1: Escrever os testes que falham.**

`manifests.spec.ts` (lê os dois `manifest.json` do disco) checa, para cada manifest:
- `id` casa com `/^[a-z0-9-]+\.[a-z0-9-]+$/`;
- `version` casa com `/^\d+\.\d+\.\d+$/`;
- tem `manifestVersion: 1`, `name` e `contributions`;
- toda `url` de contribuição existe como arquivo na pasta;
- `api_url` é do tipo `url`, obrigatório e com default `__URL_PUBLICA__`.

E, por extensão:
- **admin:** `id === 'kentro.shop-admin'`; a única contribuição é `topMenu` com `visibility.userTypes` igual a `[0]`; existe o campo `chave_admin` do tipo `secret`;
- **atendimento:** `id === 'kentro.shop'`; a única contribuição é `chatPanel`; `chave_atendimento` é do tipo `secret` e obrigatório.

`extensao.e2e-spec.ts` (`urlPublica: 'https://shop.teste'`):
- `GET /extensao/atendimento/manifest.json` → 200, `access-control-allow-origin: *`, e `JSON.parse(body).config` com `api_url.default === 'https://shop.teste'`;
- `GET /extensao/admin/config.html` → 200, `content-type` contém `text/html`;
- `GET /extensao/outra/manifest.json` → 404;
- `GET /extensao/admin/..%2f..%2fpackage.json` → 404 e `GET /extensao/admin/nao-existe.html` → 404 (Foco 4);
- `OPTIONS /extensao/admin/manifest.json` → 204 com o cabeçalho de CORS.
- [ ] **Passo 2:** `npm test -- extensao manifests`. Esperado: FALHA.
- [ ] **Passo 3:** implementar. Leia o arquivo com `fs.promises.readFile(path.join(dirExtensao, ext, arquivo))`; o regex já impede barras e `..`.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: manifests e serviço das extensões com CORS".

---

### Tarefa 7: Telas da Fase 0 das duas extensões

**Arquivos:**
- Modificar: `extension/atendimento/painel.html`, `extension/admin/config.html`
- Criar: `api/test/omni-falso.ts`
- Teste: `api/test/painel.spec.ts`, `api/test/config-admin.spec.ts`
- Dependência de desenvolvimento: `jsdom`

**Interfaces:**
- Consome: `GET /v1/loja`, `POST /v1/lojas/registrar` (Tarefa 4) e o SDK `omni` (`docs/kentro/sdk-omni-referencia.md`).
- Produz, nos dois HTML:
  - JavaScript ES5 inline, sem dependências, com os tokens `--ext-*` declarados com fallback em `:where(:root)` (como a demo).
  - `api(caminho, opcoes)` via `omni.http.request`:
    - URL = `ctx.config.api_url.replace(/\/+$/, '') + caminho` (Foco 2);
    - cabeçalhos `X-Loja-Chave`, `X-Kentro-Usuario-Id` e `X-Kentro-Usuario-Nome` (de `ctx.user`);
    - corpo como string JSON;
    - quando `omni.http.request` rejeita com `code: 'http_error'`, usa `status`/`body` do erro, como `interpretar` na SisAgenda/demo;
    - `rate_limited` → "Muitas consultas seguidas. Aguarde um minuto.".
  - `copiar(texto, sucesso)`: igual à função `copiar` da demo (`shopping_dos_pisos/extensao/index.html:331-349`).
  - `omni.ui.resize(document.body.scrollHeight + 16)` via `ResizeObserver` no painel.
- `omni-falso.ts`: `montarTela(arquivoHtml: string, opcoes: { config: Record<string, string>; respostas: Record<string, { status: number; body: unknown }>; storage?: Record<string, unknown> }): Promise<{ document: Document; chamadas: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }>; storage: Record<string, unknown>; clicar(id: string): Promise<void> }>`.
  - Carrega o HTML no jsdom com `runScripts: 'dangerously'`.
  - Antes dos scripts, injeta um `window.omni` com `ready`, `on`, `http.request`, `ui.toast/resize/confirm`, `storage.get/set/remove` e `chats.getSelected` (devolve `null`).
  - `http.request` responde pelo mapa `respostas`, chaveado por `"MÉTODO caminho"`: 2xx resolve `{ status, body: JSON.stringify(body) }`; os outros rejeitam `{ code: 'http_error', status, body }`.
  - Aguarda as microtasks depois de `ready` e de cada clique.

Comportamento e textos exatos:
- **Painel (atendimento):**
  - sem `chave_atendimento` → `#aviso` = "Peça ao administrador para configurar o Kentro Shop.";
  - 200 → `#status` = "Conectado à loja {nome}." (`nome` vazio vira "sem nome");
  - 401 → "A chave de atendimento do Kentro Shop é inválida. Peça ao administrador para conferir a configuração.";
  - outro erro → "Não foi possível falar com o Kentro Shop agora. Tente de novo em instantes.".
- **Configurações (admin)**, sem `chave_admin`:
  - mostra o campo `#nome-loja` e os botões `#btn-criar` ("Criar minha loja no Kentro Shop") e `#btn-ja-tenho` ("Já tenho uma chave");
  - `#btn-ja-tenho` mostra o passo a passo de colar a chave;
  - se o `omni.storage` tiver `chaves_pendentes`, reexibe a seção `#chaves` sem registrar de novo;
  - `#btn-criar` chama `POST /v1/lojas/registrar` com `{ nome }` (`nome` omitido se vazio), grava `chaves_pendentes` = `{ chaveAdmin, chaveAtendimento, tokenMcp, em: <ISO> }` no `omni.storage` e mostra `#chaves` com três linhas (rótulo, valor em `<code>` e botão "Copiar") mais este passo a passo:
    1. "Copie a Chave de admin e cole em Gestão > Extensões instaladas > Kentro Shop — Admin > Configurar > Chave de admin > Salvar.";
    2. "Instale o Kentro Shop — Atendimento e cole a Chave de atendimento no campo Chave de atendimento.";
    3. "Guarde o Token MCP: ele será usado na configuração da IA.";
    4. "Depois de salvar, feche e abra esta tela de novo.";
    - aviso em destaque: "Estas chaves aparecem só agora. Copie antes de fechar.".
- **Configurações (admin)**, com `chave_admin`:
  - `GET /v1/loja` 200 → `#status` = "Loja {nome} configurada. Status: {status}." e remove `chaves_pendentes` do storage;
  - 401 → "A chave de admin é inválida. Cole a chave correta na configuração da extensão ou crie uma loja nova.", com o botão `#btn-criar` visível.

- [ ] **Passo 1: Escrever os testes que falham.**

`painel.spec.ts`:
- os quatro estados acima, cada um com o texto exato;
- com `api_url: 'https://api.teste/'`, a chamada vai para `https://api.teste/v1/loja` (Foco 2);
- a chamada leva `X-Loja-Chave` igual à chave da config.

`config-admin.spec.ts`:
- sem chave → `#btn-criar` visível;
- clicar com o nome "Loja X" → a chamada é `POST https://api.teste/v1/lojas/registrar` com corpo `{"nome":"Loja X"}`; `#chaves` mostra as três chaves; `storage.chaves_pendentes.chaveAdmin` igual à da resposta;
- com `chaves_pendentes` no storage e sem chave → `#chaves` visível e nenhuma chamada feita;
- com chave → 200 mostra o texto de status e remove `chaves_pendentes`;
- 401 mostra o texto de chave inválida.
- [ ] **Passo 2:** `npm test -- painel config-admin`. Esperado: FALHA.
- [ ] **Passo 3:** implementar os dois HTML.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Ponto de commit:** "feat: telas da Fase 0 das extensões".

---

### Tarefa 8: Placeholder do catálogo e build único

**Arquivos:**
- Criar: `storefront/package.json`, `storefront/vite.config.ts`, `storefront/tsconfig.json`, `storefront/index.html`, `storefront/src/main.tsx`, `api/src/catalogo/catalogo-pagina.controller.ts`
- Modificar: `package.json` (raiz, script `build`), `api/src/app.module.ts`
- Teste: `api/test/catalogo-pagina.e2e-spec.ts`

**Interfaces:**
- Consome: `CONFIG_APP.dirPublic`.
- Produz:
  - Storefront Vite + Preact (`@preact/preset-vite`), `build.outDir: '../dist/public'`, `emptyOutDir: true`. `main.tsx` renderiza em `#app` a tela "Este link não está mais disponível. Peça um novo link no WhatsApp." (a tela de link inválido da spec 9; a Fase 1 troca pelo catálogo).
  - `GET /c/:token` → `dirPublic/index.html` com `Content-Type: text/html; charset=utf-8` e `Cache-Control: no-cache`. Arquivos de `dirPublic/assets/*` são servidos estáticos via `useStaticAssets(dirPublic, { prefix: '/', index: false })` no `configurarApp`.
  - Script `build` da raiz, nesta ordem:
    1. `npm run build -w storefront`;
    2. `npm run build -w api` (tsc → `dist/`);
    3. `node -e` copiando `api/prisma` → `dist/prisma` e `extension/atendimento` + `extension/admin` → `dist/extensao/*`.
  - `api/package.json`: `postinstall: prisma generate`, para o client existir na VPS.

- [ ] **Passo 1: Escrever o teste que falha.** `catalogo-pagina.e2e-spec.ts` (`dirPublic` = pasta temporária com `index.html` contendo `<div id="app"></div>` e `assets/a.js`):
  - `GET /c/qualquer` → 200, `text/html`, corpo contém `id="app"`;
  - `GET /assets/a.js` → 200.
- [ ] **Passo 2:** `npm test -- catalogo-pagina`. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA (tudo).
- [ ] **Passo 5: Verificar o build de ponta a ponta.**
  1. `npm run build` na raiz. Esperado: existem `dist/main.js`, `dist/public/index.html`, `dist/extensao/admin/manifest.json` e `dist/prisma/schema.prisma`.
  2. Com `npm run db:local` rodando, subir `node dist/main.js` com `DATABASE_URL`=(url local), `CHAVE_MESTRA_CRIPTO`=`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, `TOKEN_SUPERADMIN=local` e `URL_PUBLICA=http://localhost:3000`.
  3. Esperado:
     - `curl localhost:3000/` → `{"ok":true}`;
     - `curl -i localhost:3000/extensao/atendimento/manifest.json` → `access-control-allow-origin: *` e `"default":"http://localhost:3000"`;
     - `curl localhost:3000/c/x` → HTML do placeholder.
  4. Rodar `node dist/main.js` uma segunda vez sobre o mesmo banco: as migrações não reaplicam nada e o boot sobe normalmente.
- [ ] **Passo 6: Ponto de commit:** "feat: placeholder do catálogo e build único".

---

### Tarefa 9: Deploy na VPS, instalação na Kentro e atualização da spec

Esta tarefa depende do usuário (acesso à VPS e ao DNS) e de ações externas. **Peça confirmação antes de instalar qualquer coisa na Kentro.**

- [ ] **Passo 1: Atualizar a spec.** Registrar os desvios 1 a 6 deste plano nas seções 4.1, 4.2, 4.3, 8.2 (`GET /v1/loja` aceita as duas chaves) e 12 (só `lojas` na Fase 0). Na tabela 4.2 fica um projeto só:

  | campo | valor |
  |---|---|
  | Pasta do projeto | raiz do repositório |
  | Como construir | `npm run build` → `dist/main.js` |
  | Porta e verificação | 3000 / `/` |
  | Variáveis | `DATABASE_URL`, `CHAVE_MESTRA_CRIPTO`, `TOKEN_SUPERADMIN`, `URL_PUBLICA` |
  | Banco | Postgres da VPS ligado |
- [ ] **Passo 2: Usuário:** criar o projeto na VPS, configurar o domínio com HTTPS e preencher as variáveis. Gerar `CHAVE_MESTRA_CRIPTO` com o comando da Tarefa 8, passo 5, guardar em local seguro e **nunca trocar** (as credenciais cifradas dependem dela).
- [ ] **Passo 3: Verificar o deploy:**
  - `curl -i https://<domínio>/extensao/admin/manifest.json` → 200 com `access-control-allow-origin: *` e `api_url.default` igual ao domínio;
  - `extension_installs_probe_manifest` (MCP da Kentro) com as duas URLs → `installable: true`.
- [ ] **Passo 4: Com OK do usuário:** instalar o Kentro Shop — Admin (filtro `userTypes: [0]`) e o Kentro Shop — Atendimento na instância de teste. Criar a loja pela tela de Configurações, colar as chaves, conferir "Conectado à loja …" no painel de um atendimento.
- [ ] **Passo 5:** responder o ⚠ da seção 10.0: abrir a Kentro com um usuário agente e confirmar que a extensão Admin não monta. Registrar o resultado na seção 17.1 da spec.
- [ ] **Passo 6: Ponto de commit:** "docs: spec atualizada com o deploy da Fase 0".

**Aceite da Fase 0 (spec 16):** as duas extensões instalam pela URL do manifest hospedado na VPS, o painel mostra a loja conectada e os itens ⚠ da seção 17 estão respondidos na spec.
