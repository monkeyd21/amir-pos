-- Track per-vendor accounts-payable.
--
-- New columns on inventory_movements:
--   unitCost     — what we paid per unit (purchase movements only)
--   paymentMode  — CASH (paid in full at receipt) or CREDIT (added to AP)
--   dueDate      — when the credit is due
--
-- New table vendor_payments — records subsequent payments against credit
-- purchases. Vendor balance = sum(unitCost*qty for credit purchases) -
-- sum(vendor_payments.amount).

CREATE TYPE "InventoryPaymentMode" AS ENUM ('cash', 'credit');

ALTER TABLE "inventory_movements" ADD COLUMN "unitCost" DECIMAL(10, 2);
ALTER TABLE "inventory_movements" ADD COLUMN "paymentMode" "InventoryPaymentMode";
ALTER TABLE "inventory_movements" ADD COLUMN "dueDate" TIMESTAMP(3);

CREATE TABLE "vendor_payments" (
    "id"          SERIAL          PRIMARY KEY,
    "vendorId"    INTEGER         NOT NULL,
    "amount"      DECIMAL(10, 2)  NOT NULL,
    "method"      TEXT            NOT NULL,
    "reference"   TEXT,
    "notes"       TEXT,
    "paymentDate" TIMESTAMP(3)    NOT NULL,
    "createdBy"   INTEGER         NOT NULL,
    "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "vendor_payments"
    ADD CONSTRAINT "vendor_payments_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vendor_payments"
    ADD CONSTRAINT "vendor_payments_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "vendor_payments_vendorId_idx" ON "vendor_payments"("vendorId");
CREATE INDEX "vendor_payments_paymentDate_idx" ON "vendor_payments"("paymentDate");
CREATE INDEX "inventory_movements_vendorId_idx" ON "inventory_movements"("vendorId");
