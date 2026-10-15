-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('size_issue', 'colour_mismatch', 'defect_damage', 'changed_mind', 'wrong_item', 'not_as_expected');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'supervisor';

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "businessDate" DATE,
ADD COLUMN     "reasonCode" "ReturnReason";

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "unitCost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_day_marks" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "businessDate" DATE NOT NULL,
    "markedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_day_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_dismissals" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "dismissedBy" INTEGER NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key_key" ON "user_preferences"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "expense_day_marks_branchId_businessDate_key" ON "expense_day_marks"("branchId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_dismissals_branchId_key_key" ON "dashboard_dismissals"("branchId", "key");

-- CreateIndex
CREATE INDEX "inventory_movements_variantId_branchId_type_createdAt_idx" ON "inventory_movements"("variantId", "branchId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");

-- CreateIndex
CREATE INDEX "return_items_returnId_idx" ON "return_items"("returnId");

-- CreateIndex
CREATE INDEX "return_items_variantId_idx" ON "return_items"("variantId");

-- CreateIndex
CREATE INDEX "returns_branchId_businessDate_idx" ON "returns"("branchId", "businessDate");

-- CreateIndex
CREATE INDEX "returns_originalSaleId_idx" ON "returns"("originalSaleId");

-- CreateIndex
CREATE INDEX "sale_items_saleId_idx" ON "sale_items"("saleId");

-- CreateIndex
CREATE INDEX "sale_items_variantId_idx" ON "sale_items"("variantId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_day_marks" ADD CONSTRAINT "expense_day_marks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_day_marks" ADD CONSTRAINT "expense_day_marks_markedBy_fkey" FOREIGN KEY ("markedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_dismissals" ADD CONSTRAINT "dashboard_dismissals_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_dismissals" ADD CONSTRAINT "dashboard_dismissals_dismissedBy_fkey" FOREIGN KEY ("dismissedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Backfills ──────────────────────────────────────

-- Cost snapshot for lines sold before it existed. The only cost on record for
-- them is today's, so that is what they get, resolved in the same order the
-- P&L uses. A zero cost means "never entered", so it stays NULL and counts
-- against cost coverage instead of posing as 100% margin.
UPDATE "sale_items" si
SET "unitCost" = NULLIF(COALESCE(v."landingOverride", p."landingPrice", v."costOverride", p."costPrice"), 0)
FROM "product_variants" v
JOIN "products" p ON p."id" = v."productId"
WHERE v."id" = si."variantId" AND si."unitCost" IS NULL;

-- Trading day for past returns: the shift the returning user had open at the
-- time, else the India calendar day of the return.
UPDATE "returns" r
SET "businessDate" = COALESCE(
  (SELECT s."businessDate" FROM "pos_sessions" s
    WHERE s."userId" = r."userId"
      AND s."openedAt" <= r."createdAt"
      AND (s."closedAt" IS NULL OR s."closedAt" >= r."createdAt")
    ORDER BY s."openedAt" DESC LIMIT 1),
  (r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
)
WHERE r."businessDate" IS NULL;

-- Reason codes from the old dropdown values. Free text, "other" and
-- "duplicate_purchase" have no honest mapping and stay uncoded; their text is
-- kept in "reason".
UPDATE "returns" SET "reasonCode" = CASE "reason"
    WHEN 'size_issue'           THEN 'size_issue'::"ReturnReason"
    WHEN 'defective_damaged'    THEN 'defect_damage'::"ReturnReason"
    WHEN 'defective'            THEN 'defect_damage'::"ReturnReason"
    WHEN 'wrong_size'           THEN 'size_issue'::"ReturnReason"
    WHEN 'wrong_item'           THEN 'wrong_item'::"ReturnReason"
    WHEN 'changed_mind'         THEN 'changed_mind'::"ReturnReason"
    WHEN 'quality_not_expected' THEN 'not_as_expected'::"ReturnReason"
    WHEN 'not_as_described'     THEN 'not_as_expected'::"ReturnReason"
  END
WHERE "reasonCode" IS NULL;
