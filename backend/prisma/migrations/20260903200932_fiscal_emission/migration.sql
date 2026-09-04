-- AlterEnum
ALTER TYPE "FiscalStatus" ADD VALUE 'PROCESSANDO';

-- AlterTable
ALTER TABLE "FiscalDocument" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "qrCode" TEXT;

-- CreateIndex
CREATE INDEX "FiscalDocument_status_idx" ON "FiscalDocument"("status");
