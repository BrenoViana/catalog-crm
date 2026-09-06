-- Snapshot de quanto cada devolucao tirou da gaveta.
--
-- A devolucao rateia o total pelas formas de pagamento originais: crediario e
-- promessa de pagamento, resgate de fidelidade e credito da propria loja, e so
-- o que sobra sai em especie. O cancelamento posterior precisa desse numero
-- para nao estornar duas vezes nem reter dinheiro do cliente (SEC-076).
--
-- Devolucoes antigas recebem o proprio total quando o reembolso foi em
-- dinheiro: antes desta rodada nao existia venda no crediario nem resgate de
-- fidelidade, entao o valor em especie era o total.
ALTER TABLE "SaleReturn" ADD COLUMN "cashRefunded" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "SaleReturn" SET "cashRefunded" = "total" WHERE "refundMethod" = 'DINHEIRO';
