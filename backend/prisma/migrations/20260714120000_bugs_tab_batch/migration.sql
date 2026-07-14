-- Bugs-tab batch: shift-based business date, child birth month, min-stock default 0, Size master.

-- §bug6 — optional child birth MONTH (1-12) for the monthly marketing report.
ALTER TABLE "customers" ADD COLUMN "childBirthMonth" INTEGER;

-- §bug8 — reorder threshold defaults to 0 (single-piece stock is the norm).
ALTER TABLE "inventory" ALTER COLUMN "minStockLevel" SET DEFAULT 0;

-- §11.0 — trading day (business_date) on the shift and on every sale.
ALTER TABLE "pos_sessions" ADD COLUMN "businessDate" DATE;
ALTER TABLE "sales" ADD COLUMN "businessDate" DATE;

-- §bug4 — reusable Size master (mirrors colors).
CREATE TABLE "sizes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sizes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sizes_name_key" ON "sizes"("name");

CREATE INDEX "pos_sessions_branchId_status_idx" ON "pos_sessions"("branchId", "status");
CREATE INDEX "sales_branchId_businessDate_idx" ON "sales"("branchId", "businessDate");

-- Backfill business_date for existing rows from their raw timestamp so historical
-- reporting keeps working the moment rollups switch to business_date. (Legacy
-- rows predate shift-based dating; their calendar date is the best available proxy.)
UPDATE "sales" SET "businessDate" = ("createdAt")::date WHERE "businessDate" IS NULL;
UPDATE "pos_sessions" SET "businessDate" = ("openedAt")::date WHERE "businessDate" IS NULL;

-- Seed the Size master from sizes already in use on variants, so the picker is
-- pre-populated on day one. sortOrder stays 0 (manually reorderable later).
INSERT INTO "sizes" ("name")
SELECT DISTINCT "size" FROM "product_variants"
WHERE "size" IS NOT NULL AND btrim("size") <> ''
ON CONFLICT ("name") DO NOTHING;
