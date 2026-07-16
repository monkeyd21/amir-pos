-- Add supplier lot/batch code and per-variant landing cost override to product variants.
-- Applied manually on prod 2026-07-16 (ADD COLUMN IF NOT EXISTS); recorded here for repo history.
ALTER TABLE "product_variants" ADD COLUMN "lotCode" TEXT;
ALTER TABLE "product_variants" ADD COLUMN "landingOverride" DECIMAL(10,2);
