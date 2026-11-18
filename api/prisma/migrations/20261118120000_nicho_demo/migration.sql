-- Demonstração: o ramo de loja (farmácia, pet shop...) do link, escolhido pelo atendente. Nulo = o padrão da loja.
ALTER TABLE "sessoes" ADD COLUMN "nicho" TEXT;
ALTER TABLE "links_sessao" ADD COLUMN "nicho" TEXT;
