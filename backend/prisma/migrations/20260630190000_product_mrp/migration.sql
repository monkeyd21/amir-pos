-- §13.3 — MRP list price; basePrice is the auto-calculated Sale Price (MRP-10%).
ALTER TABLE "products" ADD COLUMN "mrp" DECIMAL(10,2);
