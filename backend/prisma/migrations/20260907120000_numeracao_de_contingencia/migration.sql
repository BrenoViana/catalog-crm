-- Numeracao de contingencia (F3): registro de terminais, marca de origem da
-- venda com chave idempotente, e trilha de contingencia fiscal (serie propria,
-- tpEmis=9, reconciliacao na reconexao).
--
-- PRE-CHECK ao aplicar numa base existente, antes de criar o indice unico de
-- (model, series, number) do FiscalDocument:
--   SELECT model, series, number, count(*) FROM "FiscalDocument"
--   GROUP BY 1, 2, 3 HAVING count(*) > 1;
-- Nao pode haver linha repetida. Series normal e de contingencia sao disjuntas
-- por regra de negocio (validada na aplicacao); o indice e o backstop.

-- CreateEnum
CREATE TYPE "SaleOrigin" AS ENUM ('ONLINE', 'CONTINGENCIA');

-- CreateEnum
CREATE TYPE "FiscalEmissionType" AS ENUM ('NORMAL', 'CONTINGENCIA_OFFLINE');

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contingencySeries" INTEGER,
    "contingencyRangeStart" INTEGER,
    "contingencyRangeEnd" INTEGER,
    "contingencyNextNumber" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_code_key" ON "Terminal"("code");

-- CreateIndex
CREATE INDEX "Terminal_active_idx" ON "Terminal"("active");

-- AlterTable
ALTER TABLE "Sale"
    ADD COLUMN "origin" "SaleOrigin" NOT NULL DEFAULT 'ONLINE',
    ADD COLUMN "terminalId" TEXT,
    ADD COLUMN "clientRef" TEXT;

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN "terminalId" TEXT;

-- AlterTable
ALTER TABLE "FiscalDocument"
    ADD COLUMN "emissionType" "FiscalEmissionType" NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "emittedInContingencyAt" TIMESTAMP(3),
    ADD COLUMN "contingencyRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreSettings"
    ADD COLUMN "nfceContingencySeries" INTEGER,
    ADD COLUMN "nfceContingencyNextNumber" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "nfceContingencyActive" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_terminalId_clientRef_key" ON "Sale"("terminalId", "clientRef");

-- CreateIndex
CREATE INDEX "Sale_terminalId_idx" ON "Sale"("terminalId");

-- CreateIndex
CREATE INDEX "CashSession_terminalId_idx" ON "CashSession"("terminalId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_model_series_number_key" ON "FiscalDocument"("model", "series", "number");

-- CreateIndex
CREATE INDEX "FiscalDocument_status_contingencyRetryAt_idx" ON "FiscalDocument"("status", "contingencyRetryAt");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
