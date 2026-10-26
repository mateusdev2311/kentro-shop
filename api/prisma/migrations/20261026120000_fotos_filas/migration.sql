-- AlterTable
ALTER TABLE "catalogos_kentro" ADD COLUMN     "fotos_erro" TEXT,
ADD COLUMN     "fotos_erro_em" TIMESTAMP(3),
ADD COLUMN     "fotos_sincronizadas_em" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "produtos_kentro" ADD COLUMN     "codigo_barras" TEXT;

-- AlterTable
ALTER TABLE "configuracoes_loja" ADD COLUMN     "filas_atendimento" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "fotos_produto" (
    "origem" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "arquivo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "modificado_em" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "imagem" BYTEA NOT NULL,
    "baixada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_produto_pkey" PRIMARY KEY ("origem","chave","ordem")
);

-- CreateIndex
CREATE INDEX "fotos_produto_hash_idx" ON "fotos_produto"("hash");

