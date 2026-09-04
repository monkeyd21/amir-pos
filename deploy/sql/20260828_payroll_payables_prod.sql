-- Payroll + payables — PROD application script (28 Aug 2026).
--
-- HISTORICAL. This script has already been applied to production and is kept as
-- the record of how that release reached the box. It is not the current process:
-- prod's migration history was repaired on 2026-09-04 and `prisma migrate deploy`
-- is the normal path again. See docs/deploy-notes.md.
--
-- At the time this ran, prod could not use `prisma migrate deploy`:
-- `_prisma_migrations` was drifted (20260508210000_add_held_transactions was
-- recorded unfinished, and historical_bills had been applied with no migrate
-- record), so migrate refused to proceed. Schema changes went on by hand
-- instead. This script is the by-hand equivalent of these three repo
-- migrations:
--   20260828120000_payables_model
--   20260828120100_payroll_attendance
--   20260828120200_commission_paid_meta
--
-- Every statement is idempotent — safe to re-run, and safe to run against a
-- database where some of it already exists. Wrapped in a single transaction so
-- a failure anywhere leaves prod exactly as it was.
--
-- Verified by rehearsal against a local restore of the prod schema dump.

BEGIN;

-- ─── Enums ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PayableSource" AS ENUM ('recurring_expense', 'adhoc_expense', 'payroll', 'commission');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayableStatus" AS ENUM ('pending', 'part_paid', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayMethod" AS ENUM ('cash', 'upi', 'card', 'bank', 'cheque');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'half_day', 'late', 'paid_weekly_off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SalaryType" AS ENUM ('fixed_monthly', 'daily_wage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SalaryPeriodStatus" AS ENUM ('open', 'finalised', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Expense categories: the recurring master ────────────────────────────
-- De-duplicate names before the unique index, or the index creation aborts
-- the whole deploy.
UPDATE "expense_categories" c
   SET "name" = c."name" || ' (' || c."id" || ')'
 WHERE EXISTS (SELECT 1 FROM "expense_categories" e
                WHERE e."name" = c."name" AND e."id" < c."id");

ALTER TABLE "expense_categories"
  ADD COLUMN IF NOT EXISTS "isRecurring"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "defaultAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "dueDay"        INTEGER,
  ADD COLUMN IF NOT EXISTS "isSystem"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sortOrder"     INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_name_key" ON "expense_categories"("name");

-- Salaries is fed by payroll and refuses manual entry in the expense UI.
UPDATE "expense_categories" SET "isSystem" = true WHERE lower("name") = 'salaries';

-- ─── payables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payables" (
    "id"            SERIAL          NOT NULL,
    "branchId"      INTEGER         NOT NULL,
    "source"        "PayableSource" NOT NULL,
    "categoryId"    INTEGER,
    "userId"        INTEGER,
    "periodMonth"   TEXT,
    "title"         TEXT            NOT NULL,
    "description"   TEXT,
    "amount"        DECIMAL(12,2)   NOT NULL,
    "paidAmount"    DECIMAL(12,2)   NOT NULL DEFAULT 0,
    "dueDate"       DATE,
    "status"        "PayableStatus" NOT NULL DEFAULT 'pending',
    "isSystem"      BOOLEAN         NOT NULL DEFAULT false,
    "sourceRefType" TEXT,
    "sourceRefId"   INTEGER,
    "dedupeKey"     TEXT,
    "receiptUrl"    TEXT,
    "createdBy"     INTEGER         NOT NULL,
    "createdAt"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payables_dedupeKey_key" ON "payables"("dedupeKey");
CREATE INDEX IF NOT EXISTS "payables_branchId_status_dueDate_idx" ON "payables"("branchId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "payables_periodMonth_source_idx" ON "payables"("periodMonth", "source");

CREATE TABLE IF NOT EXISTS "payable_payments" (
    "id"        SERIAL        NOT NULL,
    "payableId" INTEGER       NOT NULL,
    "amount"    DECIMAL(12,2) NOT NULL,
    "method"    "PayMethod"   NOT NULL,
    "paidAt"    TIMESTAMP(3)  NOT NULL,
    "sessionId" INTEGER,
    "reference" TEXT,
    "notes"     TEXT,
    "createdBy" INTEGER       NOT NULL,
    "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payable_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payable_payments_payableId_idx" ON "payable_payments"("payableId");
CREATE INDEX IF NOT EXISTS "payable_payments_paidAt_idx" ON "payable_payments"("paidAt");

-- ─── salary_periods ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "salary_periods" (
    "id"                   SERIAL               NOT NULL,
    "userId"               INTEGER              NOT NULL,
    "branchId"             INTEGER              NOT NULL,
    "month"                TEXT                 NOT NULL,
    "salaryType"           "SalaryType"         NOT NULL,
    "baseAmount"           DECIMAL(10,2)        NOT NULL,
    "perDayRate"           DECIMAL(10,2)        NOT NULL,
    "presentDays"          INTEGER              NOT NULL DEFAULT 0,
    "absentDays"           INTEGER              NOT NULL DEFAULT 0,
    "halfDays"             INTEGER              NOT NULL DEFAULT 0,
    "lateDays"             INTEGER              NOT NULL DEFAULT 0,
    "paidOffDays"          INTEGER              NOT NULL DEFAULT 0,
    "unmarkedDays"         INTEGER              NOT NULL DEFAULT 0,
    "manualDeductionTotal" DECIMAL(10,2)        NOT NULL DEFAULT 0,
    "attendanceDeduction"  DECIMAL(10,2)        NOT NULL DEFAULT 0,
    "netAmount"            DECIMAL(10,2)        NOT NULL DEFAULT 0,
    "status"               "SalaryPeriodStatus" NOT NULL DEFAULT 'open',
    "payableId"            INTEGER,
    "finalisedAt"          TIMESTAMP(3),
    "paidAt"               TIMESTAMP(3),
    "paidBy"               INTEGER,
    "createdAt"            TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salary_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salary_periods_payableId_key"    ON "salary_periods"("payableId");
CREATE UNIQUE INDEX IF NOT EXISTS "salary_periods_userId_month_key" ON "salary_periods"("userId", "month");
CREATE INDEX        IF NOT EXISTS "salary_periods_month_status_idx" ON "salary_periods"("month", "status");

-- ─── users: payroll config ───────────────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "joiningDate"   DATE,
  ADD COLUMN IF NOT EXISTS "salaryType"    "SalaryType",
  ADD COLUMN IF NOT EXISTS "monthlySalary" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "perDayRate"    DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "weeklyOffDay"  INTEGER;

-- ─── attendance: status replaces hours ───────────────────────────────────
ALTER TABLE "attendance"
  ADD COLUMN IF NOT EXISTS "status"          "AttendanceStatus",
  ADD COLUMN IF NOT EXISTS "manualDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "note"            TEXT,
  ADD COLUMN IF NOT EXISTS "markedBy"        INTEGER,
  ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows clocked in, so they were there.
UPDATE "attendance" SET "status" = 'present' WHERE "status" IS NULL;

ALTER TABLE "attendance" ALTER COLUMN "status"  SET NOT NULL;
ALTER TABLE "attendance" ALTER COLUMN "clockIn" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "attendance_branchId_date_idx" ON "attendance"("branchId", "date");

-- ─── commissions: settlement metadata ────────────────────────────────────
ALTER TABLE "commissions"
  ADD COLUMN IF NOT EXISTS "paidAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidBy"    INTEGER,
  ADD COLUMN IF NOT EXISTS "payableId" INTEGER;

CREATE INDEX IF NOT EXISTS "commissions_userId_status_idx" ON "commissions"("userId", "status");

-- ─── Foreign keys (each guarded — ADD CONSTRAINT has no IF NOT EXISTS) ───
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('payables',         'payables_branchId_fkey',            'branchId',   'branches',           'RESTRICT'),
      ('payables',         'payables_categoryId_fkey',          'categoryId', 'expense_categories', 'SET NULL'),
      ('payables',         'payables_userId_fkey',              'userId',     'users',              'SET NULL'),
      ('payables',         'payables_createdBy_fkey',           'createdBy',  'users',              'RESTRICT'),
      ('payable_payments', 'payable_payments_payableId_fkey',   'payableId',  'payables',           'RESTRICT'),
      ('payable_payments', 'payable_payments_sessionId_fkey',   'sessionId',  'pos_sessions',       'SET NULL'),
      ('payable_payments', 'payable_payments_createdBy_fkey',   'createdBy',  'users',              'RESTRICT'),
      ('salary_periods',   'salary_periods_userId_fkey',        'userId',     'users',              'RESTRICT'),
      ('salary_periods',   'salary_periods_branchId_fkey',      'branchId',   'branches',           'RESTRICT'),
      ('salary_periods',   'salary_periods_paidBy_fkey',        'paidBy',     'users',              'SET NULL'),
      ('salary_periods',   'salary_periods_payableId_fkey',     'payableId',  'payables',           'SET NULL'),
      ('attendance',       'attendance_markedBy_fkey',          'markedBy',   'users',              'SET NULL'),
      ('commissions',      'commissions_paidBy_fkey',           'paidBy',     'users',              'SET NULL'),
      ('commissions',      'commissions_payableId_fkey',        'payableId',  'payables',           'SET NULL')
    ) AS t(tbl, name, col, ref, on_delete)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE %s ON UPDATE CASCADE',
        fk.tbl, fk.name, fk.col, fk.ref, fk.on_delete
      );
    END IF;
  END LOOP;
END $$;

-- ─── Legacy expense backfill (decision D7) ───────────────────────────────
-- Prod's `expenses` table is EMPTY (verified 28 Aug 2026: 0 rows), so this is
-- a no-op there. It is kept because it is the correct behaviour on any
-- database that does hold legacy rows, and because dedupeKey makes it safe to
-- re-run. Rejected rows become void; everything else was paid — nobody ever
-- clicked approve, since the UI has no approve button.
INSERT INTO "payables" (
  "branchId", "source", "categoryId", "periodMonth", "title", "description",
  "amount", "paidAmount", "dueDate", "status", "isSystem",
  "dedupeKey", "receiptUrl", "createdBy", "createdAt", "updatedAt"
)
SELECT
  e."branchId",
  'adhoc_expense'::"PayableSource",
  e."categoryId",
  to_char(e."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'),
  COALESCE(NULLIF(e."description", ''), 'Expense #' || e."id"),
  e."description",
  e."amount",
  CASE WHEN e."status" = 'rejected' THEN 0 ELSE e."amount" END,
  (e."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date,
  CASE WHEN e."status" = 'rejected' THEN 'void'::"PayableStatus" ELSE 'paid'::"PayableStatus" END,
  false,
  'legacy-expense:' || e."id",
  e."receiptUrl",
  e."createdBy",
  e."createdAt",
  e."createdAt"
FROM "expenses" e
WHERE NOT EXISTS (
  SELECT 1 FROM "payables" p WHERE p."dedupeKey" = 'legacy-expense:' || e."id"
);

INSERT INTO "payable_payments" ("payableId", "amount", "method", "paidAt", "reference", "notes", "createdBy", "createdAt")
SELECT
  p."id", e."amount",
  CASE lower(trim(e."paymentMethod"))
    WHEN 'upi'    THEN 'upi'::"PayMethod"
    WHEN 'card'   THEN 'card'::"PayMethod"
    WHEN 'bank'   THEN 'bank'::"PayMethod"
    WHEN 'cheque' THEN 'cheque'::"PayMethod"
    WHEN 'check'  THEN 'cheque'::"PayMethod"
    ELSE 'cash'::"PayMethod"
  END,
  e."date", NULL,
  CASE WHEN lower(trim(e."paymentMethod")) NOT IN ('cash','upi','card','bank','cheque','check')
       THEN 'migrated; original method: ' || e."paymentMethod" END,
  e."createdBy", e."createdAt"
FROM "expenses" e
JOIN "payables" p ON p."dedupeKey" = 'legacy-expense:' || e."id"
WHERE e."status" <> 'rejected'
  AND NOT EXISTS (SELECT 1 FROM "payable_payments" pp WHERE pp."payableId" = p."id");

-- ─── Recurring config for the seeded categories ──────────────────────────
UPDATE "expense_categories" SET "isRecurring" = true, "dueDay" = 5  WHERE lower("name") = 'rent'      AND "isRecurring" = false;
UPDATE "expense_categories" SET "isRecurring" = true, "dueDay" = 10 WHERE lower("name") = 'utilities' AND "isRecurring" = false;

-- Ownership: prod runs as role `amir`.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amir') THEN
    EXECUTE 'ALTER TABLE "payables" OWNER TO amir';
    EXECUTE 'ALTER TABLE "payable_payments" OWNER TO amir';
    EXECUTE 'ALTER TABLE "salary_periods" OWNER TO amir';
    EXECUTE 'ALTER SEQUENCE "payables_id_seq" OWNER TO amir';
    EXECUTE 'ALTER SEQUENCE "payable_payments_id_seq" OWNER TO amir';
    EXECUTE 'ALTER SEQUENCE "salary_periods_id_seq" OWNER TO amir';
  END IF;
END $$;

-- ─── Match the Prisma datamodel exactly ──────────────────────────────────
-- Prisma's @updatedAt is set by the client, so the datamodel expects NO
-- database default. The defaults above exist only so the ADD COLUMN and the
-- backfill INSERTs above could run; dropping them now leaves zero schema
-- drift for the next `migrate diff` to trip over. Existing rows keep the
-- value they were given.
ALTER TABLE "attendance"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "payables"        ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "salary_periods"  ALTER COLUMN "updatedAt" DROP DEFAULT;

COMMIT;
