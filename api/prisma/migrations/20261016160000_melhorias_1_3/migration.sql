-- AlterTable
ALTER TABLE "configuracoes_loja" ADD COLUMN     "logo" BYTEA,
ADD COLUMN     "logo_hash" TEXT,
ADD COLUMN     "logo_tipo" TEXT,
ADD COLUMN     "mostrar_precos" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "sessoes" ADD COLUMN     "filtro" JSONB,
ADD COLUMN     "mostrar_precos" BOOLEAN,
ADD COLUMN     "restrito" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "clientes_loja" (
    "id" UUID NOT NULL,
    "loja_id" UUID NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "documento" TEXT,
    "enderecos" JSONB NOT NULL DEFAULT '[]',
    "pedidos" JSONB NOT NULL DEFAULT '[]',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_loja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_loja_loja_id_telefone_key" ON "clientes_loja"("loja_id", "telefone");

-- AddForeignKey
ALTER TABLE "clientes_loja" ADD CONSTRAINT "clientes_loja_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

