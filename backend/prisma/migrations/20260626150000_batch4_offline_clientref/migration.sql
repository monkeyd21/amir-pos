


-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "clientRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_clientRef_key" ON "sales"("clientRef");

