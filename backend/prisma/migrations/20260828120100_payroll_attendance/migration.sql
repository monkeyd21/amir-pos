-- Attendance rework + payroll (spec §3).
--
-- The attendance table used to measure HOURS (clock in / clock out). What the
-- store actually needs is a STATUS per day, plus an owner-discretionary
-- deduction. The clock columns are kept and made nullable so no history is
-- lost, but they are no longer written by the UI.
--
-- Every date here is an IST calendar date. The server runs UTC.

-- ─── Enums ───────────────────────────────────────────────────────────────
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'half_day', 'late', 'paid_weekly_off');
CREATE TYPE "SalaryType" AS ENUM ('fixed_monthly', 'daily_wage');
CREATE TYPE "SalaryPeriodStatus" AS ENUM ('open', 'finalised', 'paid');

-- ─── Payroll config on users (spec §3.1) ─────────────────────────────────
-- perDayRate is entered independently for BOTH salary types and is never
-- derived from days-in-month, so February doesn't change what an absence
-- costs. For fixed_monthly it exists only to price deductions.
ALTER TABLE "users"
  ADD COLUMN "joiningDate"   DATE,
  ADD COLUMN "salaryType"    "SalaryType",
  ADD COLUMN "monthlySalary" DECIMAL(10,2),
  ADD COLUMN "perDayRate"    DECIMAL(10,2),
  ADD COLUMN "weeklyOffDay"  INTEGER;

-- ─── Attendance ──────────────────────────────────────────────────────────
ALTER TABLE "attendance"
  ADD COLUMN "status"          "AttendanceStatus",
  ADD COLUMN "manualDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "note"            TEXT,
  ADD COLUMN "markedBy"        INTEGER,
  ADD COLUMN "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows clocked in, so they were there.
UPDATE "attendance" SET "status" = 'present' WHERE "status" IS NULL;

ALTER TABLE "attendance" ALTER COLUMN "status"  SET NOT NULL;
ALTER TABLE "attendance" ALTER COLUMN "clockIn" DROP NOT NULL;

CREATE INDEX "attendance_branchId_date_idx" ON "attendance"("branchId", "date");

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_markedBy_fkey"
  FOREIGN KEY ("markedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── salary_periods ──────────────────────────────────────────────────────
-- One row per employee-month. Rates are snapshotted at finalise so a later
-- pay rise can never rewrite a settled month (D10), and the row stands as the
-- permanent record of how the figure was reached. The employees module is the
-- sole authority on the calculation; payables only receives the result (§6).
CREATE TABLE "salary_periods" (
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

CREATE UNIQUE INDEX "salary_periods_payableId_key"   ON "salary_periods"("payableId");
CREATE UNIQUE INDEX "salary_periods_userId_month_key" ON "salary_periods"("userId", "month");
CREATE INDEX "salary_periods_month_status_idx"        ON "salary_periods"("month", "status");

ALTER TABLE "salary_periods" ADD CONSTRAINT "salary_periods_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_periods" ADD CONSTRAINT "salary_periods_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_periods" ADD CONSTRAINT "salary_periods_paidBy_fkey"
  FOREIGN KEY ("paidBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salary_periods" ADD CONSTRAINT "salary_periods_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma's @updatedAt expects no database default; the default above existed
-- only so ADD COLUMN could run against existing rows.
ALTER TABLE "attendance"     ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "salary_periods" ALTER COLUMN "updatedAt" DROP DEFAULT;
