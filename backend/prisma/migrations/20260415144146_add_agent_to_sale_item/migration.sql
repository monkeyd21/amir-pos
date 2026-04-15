-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "agentId" INTEGER;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
