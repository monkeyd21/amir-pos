-- AlterTable: link a sale to an exchange credit settled at checkout
ALTER TABLE "sales" ADD COLUMN     "exchangeCreditAmount" DECIMAL(10,2) DEFAULT 0,
ADD COLUMN     "exchangeReturnId" INTEGER;
