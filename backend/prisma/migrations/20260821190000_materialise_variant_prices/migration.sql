-- §13.3 — materialise every variant's price stack.
--
-- A variant whose price matched its product used to be stored with NULL
-- overrides, which made `variant.X ?? product.Y` a live subscription: editing
-- the product silently re-priced every such variant. That mis-priced 38 SKUs
-- across two incidents in Aug 2026 (NEW PKT CORD, FROCK) with no warning.
--
-- Copy the current EFFECTIVE value onto each variant so the price is owned
-- outright. This is value-preserving by construction: every expression below
-- is exactly what the read paths already resolve to, so no effective price
-- changes. Product-level prices remain as the template for NEW variants.

UPDATE product_variants v
   SET "mrpOverride" = p.mrp
  FROM products p
 WHERE p.id = v."productId"
   AND v."mrpOverride" IS NULL
   AND p.mrp IS NOT NULL;

UPDATE product_variants v
   SET "priceOverride" = p."basePrice"
  FROM products p
 WHERE p.id = v."productId"
   AND v."priceOverride" IS NULL;

UPDATE product_variants v
   SET "costOverride" = p."costPrice"
  FROM products p
 WHERE p.id = v."productId"
   AND v."costOverride" IS NULL;

-- Landing falls back to the product's landing price, then to the cost — the
-- same chain the P&L already uses (landingOverride ?? landingPrice ?? cost).
UPDATE product_variants v
   SET "landingOverride" = COALESCE(p."landingPrice", p."costPrice")
  FROM products p
 WHERE p.id = v."productId"
   AND v."landingOverride" IS NULL
   AND COALESCE(p."landingPrice", p."costPrice") IS NOT NULL;
