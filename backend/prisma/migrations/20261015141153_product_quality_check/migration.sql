-- AlterTable
ALTER TABLE "products" ADD COLUMN     "qualityCheckAt" TIMESTAMP(3),
ADD COLUMN     "qualityCheckBy" INTEGER,
ADD COLUMN     "qualityCheckNote" TEXT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_qualityCheckBy_fkey" FOREIGN KEY ("qualityCheckBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
