-- Backfill product_variants.lotCode from inventory movements.
--
-- The lot code was historically only stored on purchase movements, so labels
-- printed later via the Barcode Printing module (which reads variant.lotCode)
-- came out blank. Copy each variant's most-recent purchase lot code onto the
-- variant so every print flow shows it. Only fills rows that are currently NULL
-- (never overwrites a value already set going forward).
UPDATE "product_variants" pv
SET "lotCode" = sub."lotCode"
FROM (
  SELECT DISTINCT ON ("variantId") "variantId", "lotCode"
  FROM "inventory_movements"
  WHERE "type" = 'purchase' AND "lotCode" IS NOT NULL AND "lotCode" <> ''
  ORDER BY "variantId", "createdAt" DESC
) sub
WHERE pv."id" = sub."variantId" AND pv."lotCode" IS NULL;
