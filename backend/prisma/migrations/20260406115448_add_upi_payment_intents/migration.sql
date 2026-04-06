-- CreateTable
CREATE TABLE "upi_payment_intents" (
    "id" SERIAL NOT NULL,
    "intentId" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'cashfree',
    "branchId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "qrCodeUrl" TEXT NOT NULL,
    "upiLink" TEXT NOT NULL,
    "utrNumber" TEXT,
    "saleId" INTEGER,
    "cartSnapshot" JSONB NOT NULL,
    "customerId" INTEGER,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upi_payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upi_payment_intents_intentId_key" ON "upi_payment_intents"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "upi_payment_intents_saleId_key" ON "upi_payment_intents"("saleId");

-- CreateIndex
CREATE INDEX "upi_payment_intents_status_expiresAt_idx" ON "upi_payment_intents"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "upi_payment_intents" ADD CONSTRAINT "upi_payment_intents_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_payment_intents" ADD CONSTRAINT "upi_payment_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_payment_intents" ADD CONSTRAINT "upi_payment_intents_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upi_payment_intents" ADD CONSTRAINT "upi_payment_intents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
