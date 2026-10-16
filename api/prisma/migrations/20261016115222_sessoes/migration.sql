-- CreateEnum
CREATE TYPE "StatusSessao" AS ENUM ('link_enviado', 'navegando', 'finalizado', 'pedido_criado', 'expirado');

-- CreateEnum
CREATE TYPE "AutorEvento" AS ENUM ('cliente', 'atendente', 'sistema', 'ia');

-- CreateTable
CREATE TABLE "configuracoes_loja" (
    "loja_id" UUID NOT NULL,
    "tema" JSONB NOT NULL DEFAULT '{}',
    "entrega" JSONB NOT NULL DEFAULT '{}',
    "retirada" JSONB NOT NULL DEFAULT '{}',
    "frete" JSONB NOT NULL DEFAULT '{}',
    "lojas_retirada" JSONB NOT NULL DEFAULT '[]',
    "modo_pedido" TEXT NOT NULL DEFAULT 'handoff',
    "expiracao_link_dias" INTEGER NOT NULL DEFAULT 7,
    "categorias_ocultas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url_captura_kentro" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_loja_pkey" PRIMARY KEY ("loja_id")
);

-- CreateTable
CREATE TABLE "sessoes" (
    "id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "cliente" JSONB NOT NULL,
    "status" "StatusSessao" NOT NULL DEFAULT 'link_enviado',
    "checkout" JSONB,
    "totais" JSONB NOT NULL,
    "desconto" JSONB,
    "aberta_em" TIMESTAMP(3),
    "finalizada_em" TIMESTAMP(3),
    "expira_em" TIMESTAMP(3) NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_carrinho" (
    "id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "produto_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "variacao_nome" TEXT,
    "imagem" TEXT,
    "unidade" TEXT NOT NULL,
    "preco_unitario" DECIMAL(12,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "m2" DOUBLE PRECISION,
    "revalidado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_carrinho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_sessao" (
    "id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "autor" "AutorEvento" NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_sessao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_token_key" ON "sessoes"("token");

-- CreateIndex
CREATE INDEX "sessoes_loja_id_chat_id_idx" ON "sessoes"("loja_id", "chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "itens_carrinho_sessao_id_produto_id_variacao_id_key" ON "itens_carrinho"("sessao_id", "produto_id", "variacao_id");

-- CreateIndex
CREATE INDEX "eventos_sessao_sessao_id_em_idx" ON "eventos_sessao"("sessao_id", "em");

-- AddForeignKey
ALTER TABLE "configuracoes_loja" ADD CONSTRAINT "configuracoes_loja_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_carrinho" ADD CONSTRAINT "itens_carrinho_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_sessao" ADD CONSTRAINT "eventos_sessao_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
