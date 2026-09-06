-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "promoDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "promotionName" TEXT;
