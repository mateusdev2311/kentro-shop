-- CreateTable
CREATE TABLE "catalogos_kentro" (
    "loja_id" UUID NOT NULL,
    "grupos" JSONB NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sincronizado_em" TIMESTAMP(3),
    "lote_atual" TEXT,
    "lote_atividade_em" TIMESTAMP(3),

    CONSTRAINT "catalogos_kentro_pkey" PRIMARY KEY ("loja_id")
);

-- CreateTable
CREATE TABLE "produtos_kentro" (
    "loja_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "busca" TEXT NOT NULL,
    "grupos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dados" JSONB NOT NULL,
    "lote" TEXT NOT NULL,

    CONSTRAINT "produtos_kentro_pkey" PRIMARY KEY ("loja_id","id")
);

-- CreateIndex
CREATE INDEX "produtos_kentro_loja_id_sku_idx" ON "produtos_kentro"("loja_id", "sku");

-- CreateIndex
CREATE INDEX "produtos_kentro_loja_id_nome_idx" ON "produtos_kentro"("loja_id", "nome");

-- AddForeignKey
ALTER TABLE "catalogos_kentro" ADD CONSTRAINT "catalogos_kentro_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos_kentro" ADD CONSTRAINT "produtos_kentro_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

