-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('PERCENT', 'AMOUNT', 'FIXED_PRICE', 'BUY_X_PAY_Y');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('PRODUCT', 'CATEGORY', 'ALL');

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "kind" "PromotionKind" NOT NULL,
    "scope" "PromotionScope" NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "value" DECIMAL(12,2),
    "buyQty" INTEGER,
    "payQty" INTEGER,
    "minQuantity" DECIMAL(12,3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_active_startsAt_endsAt_idx" ON "Promotion"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Promotion_scope_productId_idx" ON "Promotion"("scope", "productId");

-- CreateIndex
CREATE INDEX "Promotion_scope_categoryId_idx" ON "Promotion"("scope", "categoryId");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
