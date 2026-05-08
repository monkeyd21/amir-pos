-- Split flat taxRate into CGST + SGST per Indian GST rules, add HSN code,
-- and a per-product flag controlling whether basePrice already includes tax.
--
-- Existing rows: copy taxRate to CGST and SGST as a 50/50 split (which is
-- how Indian GST works for intra-state sales — 18% becomes 9 + 9), and keep
-- priceIncludesTax = true so the existing tax-inclusive POS math is unchanged.

ALTER TABLE "products" ADD COLUMN "hsnCode" VARCHAR(10);
ALTER TABLE "products" ADD COLUMN "cgstRate" DECIMAL(5, 2) NOT NULL DEFAULT 9;
ALTER TABLE "products" ADD COLUMN "sgstRate" DECIMAL(5, 2) NOT NULL DEFAULT 9;
ALTER TABLE "products" ADD COLUMN "priceIncludesTax" BOOLEAN NOT NULL DEFAULT true;

UPDATE "products"
SET
  "cgstRate" = ROUND("taxRate"::numeric / 2, 2),
  "sgstRate" = "taxRate"::numeric - ROUND("taxRate"::numeric / 2, 2);

ALTER TABLE "products" DROP COLUMN "taxRate";
