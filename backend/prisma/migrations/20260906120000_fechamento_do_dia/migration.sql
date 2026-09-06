-- Fechamento financeiro do dia.
--
-- O X/Z fecha um turno; esta tabela fecha o dia inteiro da loja, consolidando
-- todos os turnos de todos os terminais num unico retrato. `snapshot` guarda os
-- numeros como estavam no momento do fechamento: recalcular no futuro devolve
-- outro valor (uma devolucao lancada depois, um titulo baixado) e o fechamento
-- deixaria de ser prova do que foi conferido. A reabertura e auditada.
CREATE TYPE "DailyClosingStatus" AS ENUM ('FECHADO', 'REABERTO');

CREATE TABLE "DailyClosing" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "DailyClosingStatus" NOT NULL DEFAULT 'FECHADO',
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalSales" DECIMAL(12,2) NOT NULL,
    "totalCashIn" DECIMAL(12,2) NOT NULL,
    "cashDifference" DECIMAL(12,2) NOT NULL,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyClosing_pkey" PRIMARY KEY ("id")
);

-- Um fechamento por dia: e a trava que impede dois gerentes fecharem o mesmo
-- dia com numeros diferentes.
CREATE UNIQUE INDEX "DailyClosing_businessDate_key" ON "DailyClosing"("businessDate");
CREATE INDEX "DailyClosing_status_idx" ON "DailyClosing"("status");
CREATE INDEX "DailyClosing_businessDate_idx" ON "DailyClosing"("businessDate");

ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
