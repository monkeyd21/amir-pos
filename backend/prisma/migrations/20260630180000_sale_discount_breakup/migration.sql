-- §12 Detailed Sales Transaction Breakup: persist the discount components
-- separately so the Sales detail page can itemize the bill. Totals math unchanged.
ALTER TABLE "sales" ADD COLUMN "manualDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN "specialDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN "loyaltyDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
