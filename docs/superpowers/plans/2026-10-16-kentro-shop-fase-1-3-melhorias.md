# Kentro Shop — Fase 1.3 (melhorias pedidas após a 1.2) — Plano

**Origem:** pedidos do usuário em 16/10/2026, depois do teste da 1.2 em produção.

**Decisões do usuário (16/10/2026):**
- Catálogo interno da Kentro lido **pelo servidor**, com um **token do MCP da instância** que o admin gera na Kentro e cola no Kentro Shop.
- Integrações nativas: **Shopify primeiro**. A Nuvemshop fica para depois, porque exige um app no portal de parceiros (OAuth).
- "Catálogo sem preço" ligado **por loja (padrão) e por link**.
- Loja com catálogo Kentro: ao finalizar, o carrinho **vai também para o carrinho nativo** do atendimento (onde há "Converter em pedido").

**Restrições que continuam:** sem commits; pt-BR; preço e total só no servidor; toda consulta filtra por loja; segredos cifrados e nunca devolvidos; TDD.

---

## Ordem das tarefas

### Tarefa 1 — Pré-cadastro do cliente (dados do contato da Kentro)
- O painel lê o contato completo (`omni.contacts.get`): nome, telefone, e-mail, documento e endereço (`postalCode`, `address`, `houseNumber`, `addressComplement`, `neighborhood`, `city`, `state`).
- `POST /v1/sessoes` aceita `email`, `documento` e `endereco` (todos opcionais, com limites de tamanho). A sessão guarda isso em `cliente`.
- O checkout do catálogo já vem preenchido com esses dados; o cliente só confere.
- Testes: sessão com endereço do contato; checkout preenchido; campos opcionais inválidos → 400.

### Tarefa 2 — Histórico do cliente pelo telefone
- Tabela nova `clientes_loja`: loja_id, telefone (só dígitos, com DDI 55), nome, e-mail, documento, `enderecos` (json, até 5, o mais recente primeiro), atualizado_em. Único (loja_id, telefone).
- A finalização grava ou atualiza o cliente da loja e o endereço usado.
- `abrir` devolve `enderecosSalvos` (do histórico + o do contato da Kentro, sem duplicar) e `pedidosAnteriores` (até 5 sessões finalizadas do mesmo telefone na mesma loja: data, itens, total).
- Catálogo: no checkout, "Usar um endereço salvo"; na vitrine, "Pedir de novo" um pedido anterior (os itens entram no carrinho e são **revalidados** como qualquer item).
- Painel: "Pedidos anteriores" do contato, com "Montar carrinho igual".
- LGPD: só a mesma loja e o mesmo telefone; a tarefa de limpeza (Fase 2) apaga clientes sem pedido há 12 meses.

### Tarefa 3 — Carrinho pronto e link com filtro (atendente; IA na Fase 1.4)
- Painel ganha a aba **Montar**: busca produtos da loja, escolhe variação e quantidade e monta o carrinho da sessão (autor `atendente` na atividade).
- Opções do link:
  - **filtro**: categoria, busca ou uma seleção de produtos ("Separados para você");
  - **restrito**: o cliente vê só o filtro (padrão), ou pode abrir o catálogo todo;
  - **sem preço** (ver Tarefa 4).
- API: `PUT /v1/sessoes/:id/carrinho` (atendimento), `POST /v1/sessoes` com `filtro`, `restrito` e `mostrarPrecos`; `GET /v1/atendimento/catalogo/produtos` (chave de atendimento).
- O catálogo aplica o filtro **no servidor**: com `restrito`, produto fora do filtro não aparece nem entra no carrinho.
- "Gerar outro link" no mesmo atendimento cria uma sessão nova quando o filtro muda.

### Tarefa 4 — Catálogo sem preço
- `configuracoes_loja.mostrar_precos` (padrão true) e, na sessão, `mostrar_precos` (herda da loja; o link pode mudar).
- Sem preço, as rotas públicas **removem** preço, "de/por", subtotal, frete e total das respostas (não é só esconder na tela). O carrinho continua revalidando no servidor.
- Finalização vira **"Enviar pedido de orçamento"**; o resumo do atendente continua com os preços (o atendente precisa deles).

### Tarefa 5 — Aparência do catálogo (aba no Admin)
- Aba **Aparência**: nome exibido, logo (upload PNG/JPG/WebP até 300 KB, guardado no banco e servido em `/v1/publico/lojas/:lojaId/logo?v=<hash>` com cache longo), cor principal, cor do topo, layout da vitrine (grade 2 colunas, grade 3 no desktop, lista), texto de boas-vindas e destaque on/off.
- Prévia ao vivo na própria aba (abre o catálogo de demonstração com o tema não salvo).
- `PATCH /v1/loja/configuracoes` (admin) com validação de cores (#RGB/#RRGGBB) e contraste mínimo do texto sobre a cor principal.

### Tarefa 6 — Abas restantes do Admin (o plano original da 1.3)
- **Entrega e retirada**: ligar/desligar, lojas de retirada, regra de frete.
- **Pedidos**: modo `handoff`, validade do link, mostrar preços (Tarefa 4).
- **Catálogo**: categorias ocultas e regras por SKU (selo, m², rendimento, compre junto).

---

# Fase 1.4 — Conectores novos

### Tarefa 7 — Conector Kentro (catálogo interno)
- Credenciais: domínio da instância (ex.: `kentro.atenderbem.com`) e **token do MCP** (secret).
- Cliente MCP (streamable HTTP): `initialize` → `tools/call` (`products_list`, `products_get`, `product_groups_list`), com sessão (`Mcp-Session-Id`), timeout, ritmo e registro em `chamadas_conector`, como os outros conectores.
- Mapeamento: `value` vem **em centavos** → reais; grupos de produtos → categorias; indisponível, arquivado ou oculto para clientes → fora do catálogo; `qty` → estoque.
- Bateria de contrato com fixtures gravadas da instância de teste.
- **Antes de implementar:** confirmar com um token real (o usuário roda um script local, como na eCommerce-net) o formato do `initialize` e do `products_get` (imagem, descrição, unidade).

### Tarefa 8 — Carrinho nativo da Kentro
- Loja com conector Kentro: quando o pedido é finalizado, o painel do atendente lança os itens no carrinho do atendimento (`omni.cart.add` com o id do produto Kentro e a quantidade) e mostra o que foi recusado (`rejected`).
- Botão "Enviar ao carrinho da Kentro" para repetir manualmente.
- Limitação conhecida: o lançamento acontece pelo painel (o SDK do carrinho só existe na extensão). Sem o painel aberto, o pedido fica com o resumo, como hoje.

### Tarefa 9 — Conector Shopify
- Credenciais: domínio `*.myshopify.com`, **Storefront access token** (catálogo) e, opcional, **Admin token** (pedidos e clientes).
- Catálogo pela Storefront API (GraphQL): busca, coleções → categorias, variações com `quantityAvailable`, imagens, preço e `compareAtPrice`.
- Com Admin token: histórico de pedidos e endereços pelo telefone (alimenta a Tarefa 2).
- Depois (modo `criar_pedido`): carrinho Shopify → `checkoutUrl` enviado ao cliente para pagar.

### Tarefa 10 — Conector Nuvemshop (quando houver o app de parceiro)
- OAuth (`/apps/{app_id}/authorize` → `/apps/authorize/token`), base `api.nuvemshop.com.br/2025-03/{store_id}`, `User-Agent` obrigatório, ritmo 2/s com rajada de 40, nomes em `{pt: ...}`.
- Catálogo, categorias, SKU, clientes e pedidos (histórico); `draft_orders` no modo `criar_pedido`.

---

# Depois: Fase 1.5 — IA (MCP do Kentro Shop) e evento de finalização
- Ferramentas da IA incluem as novas: gerar link com filtro e sem preço, montar carrinho pronto, pedidos anteriores do cliente.
