-- §8 EOD three-way reconciliation: per-mode variance log + PosSession UPI/Card/float fields.

-- 8.1a-8 closing float + 8.1b UPI + 8.1c Card reconciliation on the session.
ALTER TABLE "pos_sessions" ADD COLUMN "closingFloat" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "expectedUpi" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "upiReceived" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "upiVariance" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "upiVarianceReason" TEXT;
ALTER TABLE "pos_sessions" ADD COLUMN "expectedCard" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "cardReceived" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "cardVariance" DECIMAL(10,2);
ALTER TABLE "pos_sessions" ADD COLUMN "cardVarianceReason" TEXT;

-- 8.4 per-mode-per-day variance log (report source of truth).
CREATE TABLE "variance_logs" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "expected" DECIMAL(10,2) NOT NULL,
    "actual" DECIMAL(10,2) NOT NULL,
    "variance" DECIMAL(10,2) NOT NULL,
    "pinApproved" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "pinApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "variance_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "variance_logs_branchId_date_idx" ON "variance_logs"("branchId", "date");
CREATE INDEX "variance_logs_mode_date_idx" ON "variance_logs"("mode", "date");

ALTER TABLE "variance_logs" ADD CONSTRAINT "variance_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variance_logs" ADD CONSTRAINT "variance_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pos_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
