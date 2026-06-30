-- §8 EOD reconciliation: petty cash, cash drop, variance breakdown on sessions.
ALTER TABLE "pos_sessions" ADD COLUMN "pettyCash" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "pos_sessions" ADD COLUMN "pettyCashReason" TEXT;
ALTER TABLE "pos_sessions" ADD COLUMN "cashDrop" DECIMAL(10,2) DEFAULT 0;
ALTER TABLE "pos_sessions" ADD COLUMN "variance" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "varianceReason" TEXT;
