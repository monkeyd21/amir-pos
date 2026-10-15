import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { dateOnly } from '../../utils/ist';
import { DayRange } from './periods';

/**
 * The dashboard's numbers, computed straight from the sales tables with
 * indexed, branch-and-trading-day-bounded queries.
 *
 * The spec (§12.5) asks for a pre-computed summary table updated by deltas. We
 * deliberately don't: a delta table is only as right as the write paths that
 * remember to update it, and one forgotten path (an offline sync, an exchange
 * from the Sales screen, a manual fix) makes the numbers drift for good. These
 * queries are always right by construction and run well inside the §13 budget
 * at this store's volume. Should volume ever demand it, a summary keyed the way
 * §12.5 describes can sit behind this same interface.
 *
 * Definitions (spec §3, §12):
 * - A sale is any bill that is not void. A return reduces sales on the
 *   trading day it happens (`Return.businessDate`), not the original sale's
 *   day. A POS exchange bills the replacement in full and returns the old
 *   goods, so it nets out to the difference: "Exchange = net value".
 * - Bills Raised counts bills. An exchange is one bill (the replacement); the
 *   goods coming back are a return, not a bill.
 * - Gross profit = billed line value − landed cost, only over lines whose cost
 *   is known (`SaleItem.unitCost`). Returns give back their profit: value and
 *   cost both come off. Margin divides by COSTED sales, never by all sales,
 *   and cost coverage is value-weighted (§12.3).
 */

export interface Scope {
  branchId: number;
  /** Cashier-style "own bills only": restrict to bills this user rang up. */
  ownUserId?: number;
}

export interface PeriodTotals {
  grossSales: number;
  returnsValue: number;
  totalSales: number;
  bills: number;
  items: number;
  /** Sales minus returns, over lines with a known cost. */
  costedSales: number;
  /** Landed cost of those lines (net of returned pieces). */
  costOfGoods: number;
  grossProfit: number;
  /** Lines sold this period with no cost recorded. */
  uncostedLines: number;
  discount: number;
  /** Pre-discount bill value (Σ subtotal), the base for discount %. */
  preDiscount: number;
}

const toNum = (v: unknown): number => (v == null ? 0 : Number(v));

function bounds(range: DayRange) {
  return { from: dateOnly(range.from), to: dateOnly(range.to) };
}

function ownSales(scope: Scope): Prisma.Sql {
  return scope.ownUserId ? Prisma.sql`AND s."userId" = ${scope.ownUserId}` : Prisma.empty;
}

function ownReturns(scope: Scope): Prisma.Sql {
  return scope.ownUserId ? Prisma.sql`AND r."userId" = ${scope.ownUserId}` : Prisma.empty;
}

export async function periodTotals(scope: Scope, range: DayRange): Promise<PeriodTotals> {
  const { from, to } = bounds(range);

  const [saleRow] = await prisma.$queryRaw<any[]>`
    SELECT
      COALESCE(SUM(s.total), 0)        AS gross,
      COUNT(*)                          AS bills,
      COALESCE(SUM(s."discountAmount"), 0) AS discount,
      COALESCE(SUM(s.subtotal), 0)      AS subtotal
    FROM sales s
    WHERE s."branchId" = ${scope.branchId}
      AND s."businessDate" BETWEEN ${from} AND ${to}
      AND s.status <> 'void'
      ${ownSales(scope)}`;

  const [lineRow] = await prisma.$queryRaw<any[]>`
    SELECT
      COALESCE(SUM(si.quantity), 0) AS items,
      COALESCE(SUM(si.total) FILTER (WHERE si."unitCost" IS NOT NULL), 0) AS costed,
      COALESCE(SUM(si."unitCost" * si.quantity) FILTER (WHERE si."unitCost" IS NOT NULL), 0) AS cogs,
      COUNT(*) FILTER (WHERE si."unitCost" IS NULL) AS uncosted
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    WHERE s."branchId" = ${scope.branchId}
      AND s."businessDate" BETWEEN ${from} AND ${to}
      AND s.status <> 'void'
      ${ownSales(scope)}`;

  const [retRow] = await prisma.$queryRaw<any[]>`
    SELECT
      COALESCE(SUM(ri."unitPrice" * ri.quantity), 0) AS value,
      COALESCE(SUM(ri."unitPrice" * ri.quantity) FILTER (WHERE si."unitCost" IS NOT NULL), 0) AS costed,
      COALESCE(SUM(si."unitCost" * ri.quantity) FILTER (WHERE si."unitCost" IS NOT NULL), 0) AS cogs
    FROM return_items ri
    JOIN returns r ON r.id = ri."returnId"
    JOIN sale_items si ON si.id = ri."saleItemId"
    WHERE r."branchId" = ${scope.branchId}
      AND r."businessDate" BETWEEN ${from} AND ${to}
      AND r.status = 'completed'
      ${ownReturns(scope)}`;

  const grossSales = toNum(saleRow.gross);
  const returnsValue = toNum(retRow.value);
  const costedSales = toNum(lineRow.costed) - toNum(retRow.costed);
  const costOfGoods = toNum(lineRow.cogs) - toNum(retRow.cogs);
  return {
    grossSales,
    returnsValue,
    totalSales: round2(grossSales - returnsValue),
    bills: Number(saleRow.bills),
    items: Number(lineRow.items),
    costedSales: round2(costedSales),
    costOfGoods: round2(costOfGoods),
    grossProfit: round2(costedSales - costOfGoods),
    uncostedLines: Number(lineRow.uncosted),
    discount: toNum(saleRow.discount),
    preDiscount: toNum(saleRow.subtotal),
  };
}

export interface RefundSummary {
  count: number;
  value: number;
  /** Every reason with its count, most frequent first. Uncoded rows are left out. */
  reasons: { code: string; count: number }[];
  exchanges: number;
}

/** Refunds (money back) and exchanges (swaps) recorded in the range. */
export async function refunds(scope: Scope, range: DayRange): Promise<RefundSummary> {
  const { from, to } = bounds(range);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT r.type, r."reasonCode" AS code, COUNT(*) AS n, COALESCE(SUM(r.total), 0) AS value
    FROM returns r
    WHERE r."branchId" = ${scope.branchId}
      AND r."businessDate" BETWEEN ${from} AND ${to}
      AND r.status = 'completed'
      ${ownReturns(scope)}
    GROUP BY r.type, r."reasonCode"`;

  let count = 0;
  let value = 0;
  let exchanges = 0;
  const reasons = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.n);
    if (r.type === 'return') {
      count += n;
      value += toNum(r.value);
    } else {
      exchanges += n;
    }
    // Both refunds and swaps say why the piece came back.
    if (r.code) reasons.set(r.code, (reasons.get(r.code) ?? 0) + n);
  }
  return {
    count,
    value: round2(value),
    exchanges,
    reasons: [...reasons.entries()].map(([code, n]) => ({ code, count: n })).sort((a, b) => b.count - a.count),
  };
}

export interface CustomerMix {
  identified: number;
  returning: number;
  /** Returning share of identified customers, 0–100. Null with nobody identified. */
  returningPct: number | null;
  walkIns: number;
}

/**
 * §5.1: identified customers split into new and returning; walk-ins only
 * counted. A customer is RETURNING when they bought before this range began,
 * here or in the legacy bills imported from the old system.
 */
export async function customerMix(scope: Scope, range: DayRange): Promise<CustomerMix> {
  const { from, to } = bounds(range);
  const [row] = await prisma.$queryRaw<any[]>`
    WITH period AS (
      SELECT s."customerId"
      FROM sales s
      WHERE s."branchId" = ${scope.branchId}
        AND s."businessDate" BETWEEN ${from} AND ${to}
        AND s.status <> 'void'
        ${ownSales(scope)}
    ),
    ids AS (SELECT DISTINCT "customerId" AS id FROM period WHERE "customerId" IS NOT NULL)
    SELECT
      (SELECT COUNT(*) FROM period WHERE "customerId" IS NULL) AS walkins,
      (SELECT COUNT(*) FROM ids) AS identified,
      (SELECT COUNT(*) FROM ids WHERE
         EXISTS (SELECT 1 FROM sales p WHERE p."customerId" = ids.id AND p."businessDate" < ${from} AND p.status <> 'void')
         OR EXISTS (SELECT 1 FROM historical_bills h WHERE h."customerId" = ids.id AND h."billDate" < ${from})
      ) AS returning`;

  const identified = Number(row.identified);
  const returning = Number(row.returning);
  return {
    identified,
    returning,
    returningPct: identified > 0 ? round1((returning / identified) * 100) : null,
    walkIns: Number(row.walkins),
  };
}

export interface PaymentShare {
  mode: string;
  value: number;
  pct: number;
}

/** §6: tender share over the range, biggest first. Payment rows only (no refunds). */
export async function paymentSplit(scope: Scope, range: DayRange): Promise<PaymentShare[]> {
  const { from, to } = bounds(range);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT p.method AS mode, COALESCE(SUM(p.amount), 0) AS value
    FROM payments p
    JOIN sales s ON s.id = p."saleId"
    WHERE s."branchId" = ${scope.branchId}
      AND s."businessDate" BETWEEN ${from} AND ${to}
      AND s.status <> 'void'
      AND p.status = 'completed'
      ${ownSales(scope)}
    GROUP BY p.method`;
  const total = rows.reduce((t, r) => t + toNum(r.value), 0);
  return rows
    .map((r) => ({ mode: String(r.mode), value: round2(toNum(r.value)), pct: total > 0 ? round1((toNum(r.value) / total) * 100) : 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** UPT over the 56 trading days before `beforeDay`; null until 8 weeks of trading exist. */
export async function uptBaseline(scope: Scope, beforeDay: string): Promise<number | null> {
  const before = dateOnly(beforeDay);
  const start = new Date(before.getTime() - 56 * 24 * 60 * 60 * 1000);
  const [row] = await prisma.$queryRaw<any[]>`
    SELECT
      (SELECT MIN(s."businessDate") FROM sales s WHERE s."branchId" = ${scope.branchId} ${ownSales(scope)}) AS first_day,
      COUNT(DISTINCT s.id) AS bills,
      COALESCE(SUM(si.quantity), 0) AS items
    FROM sales s
    JOIN sale_items si ON si."saleId" = s.id
    WHERE s."branchId" = ${scope.branchId}
      AND s."businessDate" >= ${start} AND s."businessDate" < ${before}
      AND s.status <> 'void'
      ${ownSales(scope)}`;
  if (!row.first_day || new Date(row.first_day).getTime() > start.getTime()) return null;
  const bills = Number(row.bills);
  return bills > 0 ? round2(Number(row.items) / bills) : null;
}

/** The last trading day before `day` with any bill at this branch. */
export async function previousTradingDay(branchId: number, day: string): Promise<string | null> {
  const [row] = await prisma.$queryRaw<any[]>`
    SELECT MAX(s."businessDate") AS d FROM sales s
    WHERE s."branchId" = ${branchId} AND s."businessDate" < ${dateOnly(day)} AND s.status <> 'void'`;
  return row?.d ? new Date(row.d).toISOString().slice(0, 10) : null;
}

/** Whether the branch has any trading at all in `range` (YoY "no prior year data"). */
export async function hasTrading(branchId: number, range: DayRange): Promise<boolean> {
  const { from, to } = bounds(range);
  const [row] = await prisma.$queryRaw<any[]>`
    SELECT EXISTS (
      SELECT 1 FROM sales s WHERE s."branchId" = ${branchId}
        AND s."businessDate" BETWEEN ${from} AND ${to} AND s.status <> 'void'
    ) AS any`;
  return Boolean(row.any);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
