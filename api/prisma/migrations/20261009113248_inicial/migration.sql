-- CreateEnum
CREATE TYPE "StatusLoja" AS ENUM ('pendente_integracao', 'ativa', 'bloqueada');

-- CreateTable
CREATE TABLE "lojas" (
    "id" UUID NOT NULL,
    "nome" TEXT,
    "chave_admin_hash" TEXT NOT NULL,
    "chave_atendimento_hash" TEXT NOT NULL,
    "token_mcp_hash" TEXT NOT NULL,
    "status" "StatusLoja" NOT NULL DEFAULT 'pendente_integracao',
    "plano" TEXT NOT NULL DEFAULT 'gratis',
    "limites" JSONB NOT NULL DEFAULT '{}',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lojas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lojas_chave_admin_hash_key" ON "lojas"("chave_admin_hash");

-- CreateIndex
CREATE UNIQUE INDEX "lojas_chave_atendimento_hash_key" ON "lojas"("chave_atendimento_hash");

-- CreateIndex
CREATE UNIQUE INDEX "lojas_token_mcp_hash_key" ON "lojas"("token_mcp_hash");
