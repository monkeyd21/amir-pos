-- CreateEnum
CREATE TYPE "PendingSaleStatus" AS ENUM ('pending', 'finalized', 'voided');

-- CreateEnum
CREATE TYPE "UpiCreditStatus" AS ENUM ('unmatched', 'matched', 'non_sale');

-- CreateEnum
CREATE TYPE "FloorBasketStatus" AS ENUM ('open', 'billed', 'pending_sale', 'abandoned');

-- AlterTable
ALTER TABLE "loyalty_config" ADD COLUMN     "pointsExpiryMonths" INTEGER;

-- AlterTable
ALTER TABLE "loyalty_transactions" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "attribution" TEXT;

-- CreateTable
CREATE TABLE "pending_sales" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "paymentMode" "PaymentMethod" NOT NULL,
    "amountReceived" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "clientRef" TEXT,
    "status" "PendingSaleStatus" NOT NULL DEFAULT 'pending',
    "finalizedSaleId" INTEGER,
    "finalizedBy" INTEGER,
    "finalizedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedBy" INTEGER,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_sale_items" (
    "id" SERIAL NOT NULL,
    "pendingSaleId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "tagPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "pending_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upi_credits" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "payerName" TEXT,
    "payerVpa" TEXT,
    "source" TEXT NOT NULL DEFAULT 'import',
    "importBatch" TEXT,
    "status" "UpiCreditStatus" NOT NULL DEFAULT 'unmatched',
    "matchedPaymentId" INTEGER,
    "matchedSaleId" INTEGER,
    "matchedPendingSaleId" INTEGER,
    "matchMethod" TEXT,
    "nonSaleReason" TEXT,
    "resolvedBy" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upi_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_baskets" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "salespersonId" INTEGER NOT NULL,
    "status" "FloorBasketStatus" NOT NULL DEFAULT 'open',
    "saleId" INTEGER,
    "pendingSaleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_baskets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_basket_items" (
    "id" SERIAL NOT NULL,
    "basketId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floor_basket_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_sales_number_key" ON "pending_sales"("number");

-- CreateIndex
CREATE UNIQUE INDEX "pending_sales_clientRef_key" ON "pending_sales"("clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "pending_sales_finalizedSaleId_key" ON "pending_sales"("finalizedSaleId");

-- CreateIndex
CREATE INDEX "pending_sales_branchId_status_idx" ON "pending_sales"("branchId", "status");

-- CreateIndex
CREATE INDEX "pending_sales_branchId_businessDate_idx" ON "pending_sales"("branchId", "businessDate");

-- CreateIndex
CREATE INDEX "pending_sale_items_pendingSaleId_idx" ON "pending_sale_items"("pendingSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "upi_credits_matchedPaymentId_key" ON "upi_credits"("matchedPaymentId");

-- CreateIndex
CREATE INDEX "upi_credits_branchId_status_idx" ON "upi_credits"("branchId", "status");

-- CreateIndex
CREATE INDEX "upi_credits_branchId_receivedAt_idx" ON "upi_credits"("branchId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "upi_credits_branchId_reference_key" ON "upi_credits"("branchId", "reference");

-- CreateIndex
CREATE INDEX "floor_baskets_branchId_status_idx" ON "floor_baskets"("branchId", "status");

-- CreateIndex
CREATE INDEX "floor_baskets_branchId_code_status_idx" ON "floor_baskets"("branchId", "code", "status");

-- CreateIndex
CREATE INDEX "floor_basket_items_basketId_idx" ON "floor_basket_items"("basketId");

-- CreateIndex
CREATE INDEX "loyalty_transactions_customerId_createdAt_idx" ON "loyalty_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_transactions_expiresAt_idx" ON "loyalty_transactions"("expiresAt");

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_finalizedBy_fkey" FOREIGN KEY ("finalizedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_finalizedSaleId_fkey" FOREIGN KEY ("finalizedSaleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sale_items" ADD CONSTRAINT "pending_sale_items_pendingSaleId_fkey" FOREIGN KEY ("pendingSaleId") REFERENCES "pending_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sale_items" ADD CONSTRAINT "pending_sale_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_credits" ADD CONSTRAINT "upi_credits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_credits" ADD CONSTRAINT "upi_credits_matchedPaymentId_fkey" FOREIGN KEY ("matchedPaymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_credits" ADD CONSTRAINT "upi_credits_matchedSaleId_fkey" FOREIGN KEY ("matchedSaleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_credits" ADD CONSTRAINT "upi_credits_matchedPendingSaleId_fkey" FOREIGN KEY ("matchedPendingSaleId") REFERENCES "pending_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_credits" ADD CONSTRAINT "upi_credits_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_credits" ADD CONSTRAINT "upi_credits_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_baskets" ADD CONSTRAINT "floor_baskets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_baskets" ADD CONSTRAINT "floor_baskets_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_basket_items" ADD CONSTRAINT "floor_basket_items_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "floor_baskets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_basket_items" ADD CONSTRAINT "floor_basket_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
