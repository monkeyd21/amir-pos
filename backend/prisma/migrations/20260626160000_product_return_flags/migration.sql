


-- AlterTable
ALTER TABLE "products" ADD COLUMN     "exchangeOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nonReturnable" BOOLEAN NOT NULL DEFAULT false;

