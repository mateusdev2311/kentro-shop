-- CreateTable
CREATE TABLE "banners_loja" (
    "id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "imagem" BYTEA NOT NULL,
    "tipo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "titulo" TEXT,
    "categoria_id" TEXT,
    "busca" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banners_loja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banners_loja_loja_id_ordem_idx" ON "banners_loja"("loja_id", "ordem");

-- AddForeignKey
ALTER TABLE "banners_loja" ADD CONSTRAINT "banners_loja_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

