-- `20260402175541_init` already creates this table with the same shape, so on
-- a fresh database this migration found it present and failed, which broke
-- every fresh install and every `migrate dev` shadow-database replay. It is
-- kept (production records it as applied) but written to be a no-op wherever
-- the table already exists.

-- CreateTable
CREATE TABLE IF NOT EXISTS "held_transactions" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "cartData" JSONB NOT NULL,
    "customerId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_transactions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "held_transactions" ADD CONSTRAINT "held_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "held_transactions" ADD CONSTRAINT "held_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "held_transactions" ADD CONSTRAINT "held_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
