-- AlterTable
ALTER TABLE "lojas" ADD COLUMN "chave_automacao_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "lojas_chave_automacao_hash_key" ON "lojas"("chave_automacao_hash");
