-- AlterTable
ALTER TABLE "products" ADD COLUMN     "reorderLevel" INTEGER;

-- CreateTable
CREATE TABLE "inventory_weekly_snapshots" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "weekStart" DATE NOT NULL,
    "lowStockCount" INTEGER NOT NULL,
    "stagnantCount" INTEGER NOT NULL,
    "frozenValue" DECIMAL(14,2) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_weekly_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_weekly_snapshots_branchId_weekStart_key" ON "inventory_weekly_snapshots"("branchId", "weekStart");

-- AddForeignKey
ALTER TABLE "inventory_weekly_snapshots" ADD CONSTRAINT "inventory_weekly_snapshots_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
