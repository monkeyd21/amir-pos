-- Commission settlement metadata (spec §6, decision D3).
--
-- Paying commission was a bare status flip: no timestamp, no payer, and no
-- record anywhere that money left the till. It now gets the same auto-push
-- salary gets, so total staff cost in the ledger is complete.
--
-- Many commission rows settle against one payable (one per employee-month),
-- so payableId is a plain FK, not unique.
ALTER TABLE "commissions"
  ADD COLUMN "paidAt"    TIMESTAMP(3),
  ADD COLUMN "paidBy"    INTEGER,
  ADD COLUMN "payableId" INTEGER;

CREATE INDEX "commissions_userId_status_idx" ON "commissions"("userId", "status");

ALTER TABLE "commissions" ADD CONSTRAINT "commissions_paidBy_fkey"
  FOREIGN KEY ("paidBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
