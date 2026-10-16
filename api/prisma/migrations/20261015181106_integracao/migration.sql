-- CreateEnum
CREATE TYPE "StatusIntegracao" AS ENUM ('pendente', 'ok', 'erro');

-- CreateTable
CREATE TABLE "integracoes" (
    "loja_id" UUID NOT NULL,
    "plataforma" TEXT NOT NULL,
    "credenciais_cifradas" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "status" "StatusIntegracao" NOT NULL DEFAULT 'pendente',
    "ultimo_teste_em" TIMESTAMP(3),
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integracoes_pkey" PRIMARY KEY ("loja_id")
);

-- CreateTable
CREATE TABLE "chamadas_conector" (
    "id" BIGSERIAL NOT NULL,
    "loja_id" UUID NOT NULL,
    "plataforma" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "status_http" INTEGER,
    "ms" INTEGER NOT NULL,
    "erro_codigo" TEXT,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chamadas_conector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras_produto" (
    "loja_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "oculto" BOOLEAN NOT NULL DEFAULT false,
    "selo" TEXT,
    "m2_por_unidade" DOUBLE PRECISION,
    "rendimento_m2" DOUBLE PRECISION,
    "compre_junto" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regras_produto_pkey" PRIMARY KEY ("loja_id","sku")
);

-- CreateIndex
CREATE INDEX "chamadas_conector_loja_id_em_idx" ON "chamadas_conector"("loja_id", "em");

-- AddForeignKey
ALTER TABLE "integracoes" ADD CONSTRAINT "integracoes_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamadas_conector" ADD CONSTRAINT "chamadas_conector_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_produto" ADD CONSTRAINT "regras_produto_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
