-- Per-employee minimum daily-sales target for commission calculation.
-- Replaces the old store-wide `commissionDailyThreshold` setting.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commissionThreshold" DECIMAL(10,2) NOT NULL DEFAULT 0;
