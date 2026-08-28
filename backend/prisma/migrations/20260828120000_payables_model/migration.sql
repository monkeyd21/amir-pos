-- Payables: the single pending-vs-paid model (spec §4, decision D1).
--
-- The expense module becomes a view over this table and the cash-flow module
-- reads the same rows, so "what's owed" has exactly one definition. Vendor
-- credit deliberately stays in the vendor ledger (balance-forward by design,
-- see vendors/service.ts) and gift-voucher liability stays computed from
-- gift_vouchers; both join at the read layer in GET /payables/outstanding
-- rather than being copied into this table and kept in sync by hand.
--
-- The old `expenses` table is intentionally left in place, untouched and
-- read-only, for one release as a rollback net — prod is a file-copy deploy.
-- Its rows are backfilled here; the DROP happens in a later migration.

-- ─── Enums ───────────────────────────────────────────────────────────────
CREATE TYPE "PayableSource" AS ENUM ('recurring_expense', 'adhoc_expense', 'payroll', 'commission');
CREATE TYPE "PayableStatus" AS ENUM ('pending', 'part_paid', 'paid', 'void');

-- Deliberately NOT the checkout PaymentMethod enum: money going out never
-- settles in `voucher`, and money coming in never settles by cheque.
CREATE TYPE "PayMethod" AS ENUM ('cash', 'upi', 'card', 'bank', 'cheque');

-- ─── Category master gains the recurring config (spec §4.1) ──────────────
-- name becomes unique. Guard first: an existing duplicate would fail the
-- index and abort the deploy, so de-duplicate by suffixing the later rows.
UPDATE "expense_categories" c
   SET "name" = c."name" || ' (' || c."id" || ')'
 WHERE EXISTS (
   SELECT 1 FROM "expense_categories" e
    WHERE e."name" = c."name" AND e."id" < c."id"
 );

ALTER TABLE "expense_categories"
  ADD COLUMN "isRecurring"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultAmount" DECIMAL(12,2),
  ADD COLUMN "dueDay"        INTEGER,
  ADD COLUMN "isSystem"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder"     INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- Salaries is fed by the payroll module and refuses manual entry in the
-- expense UI. That is what makes "no duplicate salary entry" enforceable
-- rather than merely intended (spec §4.1 / §6).
UPDATE "expense_categories" SET "isSystem" = true WHERE lower("name") = 'salaries';

-- ─── payables ────────────────────────────────────────────────────────────
CREATE TABLE "payables" (
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

-- Idempotency for the auto-push (§6) and for month materialisation (§5.1).
-- A composite unique over (branchId, categoryId, periodMonth, source) would
-- NOT work: Postgres treats NULLs as distinct, so nullable columns can't
-- enforce it. One computed string column can.
CREATE UNIQUE INDEX "payables_dedupeKey_key" ON "payables"("dedupeKey");
CREATE INDEX "payables_branchId_status_dueDate_idx" ON "payables"("branchId", "status", "dueDate");
CREATE INDEX "payables_periodMonth_source_idx" ON "payables"("periodMonth", "source");

-- ─── payable_payments ────────────────────────────────────────────────────
-- Payments are separate rows so partial settlement is possible (D12) and so
-- the daily cash-out figure has a truthful source: the moment money left, by
-- method. sessionId ties a cash payout to the till so EOD still reconciles;
-- Cash / UPI / Card stay independent — no combined variance total (D4).
CREATE TABLE "payable_payments" (
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

CREATE INDEX "payable_payments_payableId_idx" ON "payable_payments"("payableId");
CREATE INDEX "payable_payments_paidAt_idx" ON "payable_payments"("paidAt");

ALTER TABLE "payables" ADD CONSTRAINT "payables_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payables" ADD CONSTRAINT "payables_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payables" ADD CONSTRAINT "payables_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payables" ADD CONSTRAINT "payables_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Backfill from the legacy expenses table (decision D7) ───────────────
-- Legacy rows carry a payment method and a date, so they were paid — nobody
-- ever clicked approve because the UI has no approve button. They migrate as
-- paid; rejected rows migrate as void.
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
  CASE WHEN e."status" = 'rejected' THEN 'void'::"PayableStatus"
       ELSE 'paid'::"PayableStatus" END,
  false,
  'legacy-expense:' || e."id",
  e."receiptUrl",
  e."createdBy",
  e."createdAt",
  e."createdAt"
FROM "expenses" e;

-- One payment row per migrated (non-void) expense, dated when it was spent.
-- The old paymentMethod column is free text — map what we recognise, and put
-- anything unrecognised on 'cash', which is what a small retail till defaults
-- to. Cheques and bank transfers were never expressible in the old UI.
INSERT INTO "payable_payments" ("payableId", "amount", "method", "paidAt", "reference", "notes", "createdBy", "createdAt")
SELECT
  p."id",
  e."amount",
  CASE lower(trim(e."paymentMethod"))
    WHEN 'upi'    THEN 'upi'::"PayMethod"
    WHEN 'card'   THEN 'card'::"PayMethod"
    WHEN 'bank'   THEN 'bank'::"PayMethod"
    WHEN 'cheque' THEN 'cheque'::"PayMethod"
    WHEN 'check'  THEN 'cheque'::"PayMethod"
    ELSE 'cash'::"PayMethod"
  END,
  e."date",
  NULL,
  CASE WHEN lower(trim(e."paymentMethod")) NOT IN ('cash','upi','card','bank','cheque','check')
       THEN 'migrated; original method: ' || e."paymentMethod" END,
  e."createdBy",
  e."createdAt"
FROM "expenses" e
JOIN "payables" p ON p."dedupeKey" = 'legacy-expense:' || e."id"
WHERE e."status" <> 'rejected';

-- Prisma's @updatedAt expects no database default. Dropped after the backfill
-- inserts above, which supply the column explicitly.
ALTER TABLE "payables" ALTER COLUMN "updatedAt" DROP DEFAULT;
