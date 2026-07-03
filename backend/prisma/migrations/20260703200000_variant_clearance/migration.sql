-- §2.4 Clearance pricing — per-variant dead-stock liquidation flag + fixed price.
ALTER TABLE "product_variants" ADD COLUMN "clearanceFlag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD COLUMN "clearancePrice" DECIMAL(10,2);
