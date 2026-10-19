-- AlterTable
ALTER TABLE "integracoes" ADD COLUMN     "id_externo" TEXT;

-- CreateIndex
CREATE INDEX "integracoes_plataforma_id_externo_idx" ON "integracoes"("plataforma", "id_externo");

