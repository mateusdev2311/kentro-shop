-- CreateTable
CREATE TABLE "links_sessao" (
    "id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "filtro" JSONB,
    "restrito" BOOLEAN NOT NULL DEFAULT true,
    "mostrar_precos" BOOLEAN,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "links_sessao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "links_sessao_token_key" ON "links_sessao"("token");

-- CreateIndex
CREATE INDEX "links_sessao_sessao_id_criado_em_idx" ON "links_sessao"("sessao_id", "criado_em");

-- AddForeignKey
ALTER TABLE "links_sessao" ADD CONSTRAINT "links_sessao_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

