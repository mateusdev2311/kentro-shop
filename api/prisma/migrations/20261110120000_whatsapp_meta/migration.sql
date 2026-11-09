-- CreateTable
CREATE TABLE "whatsapp_meta" (
    "loja_id" UUID NOT NULL,
    "waba_id" TEXT NOT NULL,
    "telefone_id" TEXT NOT NULL,
    "token_cifrado" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_meta_pkey" PRIMARY KEY ("loja_id")
);

-- AddForeignKey
ALTER TABLE "whatsapp_meta" ADD CONSTRAINT "whatsapp_meta_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
