-- §13.3 Per-variant MRP override. Falls back to the product's MRP when null.
ALTER TABLE "product_variants" ADD COLUMN "mrpOverride" DECIMAL(10,2);
