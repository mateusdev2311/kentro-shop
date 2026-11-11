-- Relatórios: origem do atendimento e quem finalizou, em colunas (antes só no texto dos eventos).
ALTER TABLE "sessoes" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'atendente';
ALTER TABLE "sessoes" ADD COLUMN "gerado_por" TEXT NOT NULL DEFAULT '';
ALTER TABLE "sessoes" ADD COLUMN "finalizada_por" TEXT;
ALTER TABLE "sessoes" ADD COLUMN "finalizada_por_nome" TEXT NOT NULL DEFAULT '';

CREATE INDEX "sessoes_loja_id_criada_em_idx" ON "sessoes"("loja_id", "criada_em");
CREATE INDEX "sessoes_loja_id_finalizada_em_idx" ON "sessoes"("loja_id", "finalizada_em");

-- Atendimentos antigos: pelo primeiro evento de link (o histórico guarda os últimos 30; sem ele, fica "atendente").
UPDATE "sessoes" s
SET "origem" = CASE
      WHEN e."autor" = 'ia' THEN 'ia'
      WHEN e."texto" LIKE 'Link do catálogo gerado pela URA da Kentro%' THEN 'ura'
      ELSE 'atendente'
    END,
    "gerado_por" = CASE
      WHEN e."autor" = 'atendente' AND e."texto" LIKE 'Link do catálogo gerado por %'
        THEN regexp_replace(substring(e."texto" FROM 29), ' \(o carrinho continua o mesmo\)$', '')
      ELSE ''
    END
FROM (
  SELECT DISTINCT ON ("sessao_id") "sessao_id", "autor", "texto"
  FROM "eventos_sessao"
  WHERE "tipo" = 'link'
  ORDER BY "sessao_id", "em"
) e
WHERE e."sessao_id" = s."id";

-- Quem finalizou: o evento "finalizou" (cliente pelo link ou "<nome> finalizou o pedido pelo painel").
UPDATE "sessoes" s
SET "finalizada_por" = e."autor"::text,
    "finalizada_por_nome" = CASE
      WHEN e."autor" = 'atendente' AND position(' finalizou o pedido pelo painel' IN e."texto") > 1
        THEN substring(e."texto" FROM 1 FOR position(' finalizou o pedido pelo painel' IN e."texto") - 1)
      ELSE ''
    END
FROM (
  SELECT DISTINCT ON ("sessao_id") "sessao_id", "autor", "texto"
  FROM "eventos_sessao"
  WHERE "tipo" = 'finalizou'
  ORDER BY "sessao_id", "em" DESC
) e
WHERE e."sessao_id" = s."id";

-- Finalizado sem o evento (histórico cortado): conta como cliente, o caminho mais comum.
UPDATE "sessoes" SET "finalizada_por" = 'cliente' WHERE "finalizada_em" IS NOT NULL AND "finalizada_por" IS NULL;
