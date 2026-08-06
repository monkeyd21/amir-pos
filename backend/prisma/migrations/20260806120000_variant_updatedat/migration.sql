-- Add product_variants.updatedAt to drive the clearance list's "recent first"
-- ordering (bumped whenever a variant is updated, incl. setting clearanceFlag).
-- Existing rows default to now(); @updatedAt maintains it going forward.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
