-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('walkin', 'online');

-- AlterTable: customer last name optional
ALTER TABLE "customers" ALTER COLUMN "lastName" DROP NOT NULL;

-- AlterTable: payment identifier (bank/account name) for card/UPI reconciliation
ALTER TABLE "payments" ADD COLUMN     "identifier" TEXT;

-- AlterTable: sales channel drives the bill-number prefix
ALTER TABLE "sales" ADD COLUMN     "channel" "SaleChannel" NOT NULL DEFAULT 'walkin';

-- CreateTable: per-channel bill number counter
CREATE TABLE "bill_sequences" (
    "key" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_sequences_pkey" PRIMARY KEY ("key")
);
