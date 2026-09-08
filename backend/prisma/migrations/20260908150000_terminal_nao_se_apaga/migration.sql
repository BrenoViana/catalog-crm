-- Terminal nao se apaga: a identidade do terminal na venda e permanente.
--
-- Antes, Sale.terminalId e CashSession.terminalId eram ON DELETE SET NULL.
-- Apagar um terminal zerava o terminalId das vendas dele e, com isso, anulava
-- na pratica o unico (terminalId, clientRef): no Postgres NULLs sao distintos
-- num indice unico, entao vendas orfas com o MESMO clientRef passavam a
-- conviver sem erro. Resultado: reenvio de checkout sem protecao de
-- idempotencia (risco de venda duplicada) e o backfill de terminais no boot
-- quebrando com "Unique constraint failed on Sale_terminalId_clientRef_key".
--
-- RESTRICT bloqueia apagar terminal que tenha venda ou turno. A aplicacao ja
-- so desativa terminal (campo `active`) e nao expoe rota de exclusao, entao
-- isto nao tira nenhuma capacidade existente.

ALTER TABLE "Sale" DROP CONSTRAINT "Sale_terminalId_fkey";
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_terminalId_fkey"
  FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashSession" DROP CONSTRAINT "CashSession_terminalId_fkey";
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_terminalId_fkey"
  FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
