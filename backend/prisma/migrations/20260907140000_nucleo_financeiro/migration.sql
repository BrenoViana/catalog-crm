-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('BANCO', 'CAIXA', 'CARTEIRA');

-- CreateEnum
CREATE TYPE "FinancialCategoryKind" AS ENUM ('RECEITA', 'DESPESA');

-- AlterTable
ALTER TABLE "Payable" ADD COLUMN     "competencia" TIMESTAMP(3),
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "financialCategoryId" TEXT;

-- AlterTable
ALTER TABLE "PayableSettlement" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "ReceivableSettlement" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "bankBranch" TEXT,
    "bankNumber" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCategory" (
    "id" TEXT NOT NULL,
    "kind" "FinancialCategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTransfer" (
    "id" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialAccount_active_idx" ON "FinancialAccount"("active");

-- CreateIndex
CREATE INDEX "FinancialCategory_kind_active_idx" ON "FinancialCategory"("kind", "active");

-- CreateIndex
CREATE INDEX "FinancialCategory_parentId_idx" ON "FinancialCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCategory_kind_name_parentId_key" ON "FinancialCategory"("kind", "name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_name_key" ON "CostCenter"("name");

-- CreateIndex
CREATE INDEX "CostCenter_active_idx" ON "CostCenter"("active");

-- CreateIndex
CREATE INDEX "AccountTransfer_fromAccountId_date_idx" ON "AccountTransfer"("fromAccountId", "date");

-- CreateIndex
CREATE INDEX "AccountTransfer_toAccountId_date_idx" ON "AccountTransfer"("toAccountId", "date");

-- CreateIndex
CREATE INDEX "Payable_financialCategoryId_idx" ON "Payable"("financialCategoryId");

-- CreateIndex
CREATE INDEX "Payable_costCenterId_idx" ON "Payable"("costCenterId");

-- CreateIndex
CREATE INDEX "PayableSettlement_accountId_idx" ON "PayableSettlement"("accountId");

-- CreateIndex
CREATE INDEX "Receivable_categoryId_idx" ON "Receivable"("categoryId");

-- CreateIndex
CREATE INDEX "Receivable_costCenterId_idx" ON "Receivable"("costCenterId");

-- CreateIndex
CREATE INDEX "ReceivableSettlement_accountId_idx" ON "ReceivableSettlement"("accountId");

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivableSettlement" ADD CONSTRAINT "ReceivableSettlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_financialCategoryId_fkey" FOREIGN KEY ("financialCategoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableSettlement" ADD CONSTRAINT "PayableSettlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

