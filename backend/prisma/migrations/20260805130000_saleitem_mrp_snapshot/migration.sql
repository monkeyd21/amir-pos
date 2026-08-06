-- §2.4 — snapshot the tag/MRP on each sale line at the time of sale, so bills
-- and receipts show the historical MRP even after the variant's MRP is edited
-- or it leaves clearance. For a clearance line this is the "was <MRP>" struck
-- against the fixed clearance price stored in unitPrice. Nullable so existing
-- rows survive; backfilled below from the current variant (best-effort).
ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(10,2);

-- Backfill existing sale items from the variant's current MRP:
-- variant.mrpOverride → product.mrp → product.basePrice.
UPDATE "sale_items" si
SET "mrp" = COALESCE(pv."mrpOverride", p."mrp", p."basePrice")
FROM "product_variants" pv
JOIN "products" p ON p."id" = pv."productId"
WHERE si."variantId" = pv."id" AND si."mrp" IS NULL;
