-- CreateTable
CREATE TABLE "historical_bills" (
    "id" SERIAL NOT NULL,
    "billNumber" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "originalBillNo" TEXT,
    "billDate" TIMESTAMP(3),
    "customerId" INTEGER,
    "customerNameRaw" TEXT,
    "customerMobile" TEXT,
    "grossAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cardAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_bill_items" (
    "id" SERIAL NOT NULL,
    "historicalBillId" INTEGER NOT NULL,
    "barcode" TEXT,
    "itemName" TEXT,
    "colour" TEXT,
    "size" TEXT,
    "category" TEXT,
    "brandName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "mrp" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cdPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "variantId" INTEGER,

    CONSTRAINT "historical_bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historical_bills_billNumber_key" ON "historical_bills"("billNumber");

-- CreateIndex
CREATE INDEX "historical_bills_customerId_idx" ON "historical_bills"("customerId");

-- CreateIndex
CREATE INDEX "historical_bills_billDate_idx" ON "historical_bills"("billDate");

-- CreateIndex
CREATE INDEX "historical_bill_items_historicalBillId_idx" ON "historical_bill_items"("historicalBillId");

-- CreateIndex
CREATE INDEX "historical_bill_items_barcode_idx" ON "historical_bill_items"("barcode");

-- AddForeignKey
ALTER TABLE "historical_bills" ADD CONSTRAINT "historical_bills_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_bill_items" ADD CONSTRAINT "historical_bill_items_historicalBillId_fkey" FOREIGN KEY ("historicalBillId") REFERENCES "historical_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_bill_items" ADD CONSTRAINT "historical_bill_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

