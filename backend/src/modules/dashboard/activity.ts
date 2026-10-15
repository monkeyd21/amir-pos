import { Prisma } from '@prisma/client';
import { returnReasonLabel } from '@clothing-erp/shared';
import prisma from '../../config/database';
import { dateOnly } from '../../utils/ist';
import { DayRange } from './periods';
import { round1, round2, Scope } from './metrics';

/** §7.1: High Discount is a bill discounted by more than this share of its value. */
export const HIGH_DISCOUNT_PCT = 25;

export type TransactionBadge = 'paid' | 'exchange' | 'return' | 'hold' | 'high_discount';

export interface RecentTransaction {
  kind: 'sale' | 'return' | 'hold';
  /** Sale id for sales and returns (the bill the side panel opens), hold id for holds. */
  id: number;
  number: string | null;
  name: string;
  /** Null for a walk-in: the UI shows a generic avatar. */
  customerId: number | null;
  at: string;
  mode: string | null;
  /** Signed: a refund is negative. An exchange shows the net difference. */
  amount: number;
  reason: string | null;
  badge: TransactionBadge;
  discountPct: number | null;
}

const fullName = (c: { firstName: string; lastName: string | null } | null | undefined) =>
  c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : 'Walk-in';

/**
 * §7.1: the last few things that happened at the till, newest first: bills,
 * refunds and parked (held) bills. Indexed, row-limited reads of the raw tables
 * are the one exception §13 allows to "never aggregate raw transactions".
 */
export async function recentTransactions(
  scope: Scope,
  opts: { limit: number; onlyDay?: string }
): Promise<RecentTransaction[]> {
  const take = opts.limit;
  const day = opts.onlyDay ? dateOnly(opts.onlyDay) : undefined;
  const own = scope.ownUserId ? { userId: scope.ownUserId } : {};

  const [sales, returns, holds] = await Promise.all([
    prisma.sale.findMany({
      where: { branchId: scope.branchId, status: { not: 'void' }, ...own, ...(day ? { businessDate: day } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        saleNumber: true,
        total: true,
        subtotal: true,
        discountAmount: true,
        exchangeCreditAmount: true,
        exchangeReturnId: true,
        createdAt: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        payments: { select: { method: true, amount: true } },
      },
    }),
    prisma.return.findMany({
      where: { branchId: scope.branchId, type: 'return', status: 'completed', ...own, ...(day ? { businessDate: day } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        returnNumber: true,
        total: true,
        reasonCode: true,
        reason: true,
        refundBreakup: true,
        createdAt: true,
        originalSale: { select: { id: true, customer: { select: { id: true, firstName: true, lastName: true } } } },
      },
    }),
    prisma.heldTransaction.findMany({
      where: {
        branchId: scope.branchId,
        ...own,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        // A hold has no trading day of its own: "today only" means parked
        // since midnight IST of that day (UTC midnight − 5:30).
        ...(day ? { createdAt: { gte: new Date(day.getTime() - 5.5 * 3600_000) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        cartData: true,
        createdAt: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  const rows: RecentTransaction[] = [];

  for (const s of sales) {
    const total = Number(s.total);
    const credit = Number(s.exchangeCreditAmount ?? 0);
    const isExchange = s.exchangeReturnId != null;
    const pre = Number(s.subtotal);
    const discountPct = pre > 0 ? round1((Number(s.discountAmount) / pre) * 100) : null;
    const modes = [...new Set(s.payments.filter((p) => Number(p.amount) > 0).map((p) => p.method))];
    rows.push({
      kind: 'sale',
      id: s.id,
      number: s.saleNumber,
      name: fullName(s.customer),
      customerId: s.customer?.id ?? null,
      at: s.createdAt.toISOString(),
      mode: modes.length > 1 ? 'split' : modes[0] ?? null,
      amount: round2(isExchange ? total - credit : total),
      reason: null,
      badge: isExchange ? 'exchange' : discountPct != null && discountPct > HIGH_DISCOUNT_PCT ? 'high_discount' : 'paid',
      discountPct,
    });
  }

  for (const r of returns) {
    const breakup = (r.refundBreakup as { method: string; amount: number }[] | null) ?? [];
    const modes = [...new Set(breakup.filter((b) => Number(b.amount) > 0).map((b) => b.method))];
    rows.push({
      kind: 'return',
      id: r.originalSale.id,
      number: r.returnNumber,
      name: fullName(r.originalSale.customer),
      customerId: r.originalSale.customer?.id ?? null,
      at: r.createdAt.toISOString(),
      mode: modes.length > 1 ? 'split' : modes[0] ?? null,
      amount: -round2(Number(r.total)),
      reason: returnReasonLabel(r.reasonCode) ?? r.reason,
      badge: 'return',
      discountPct: null,
    });
  }

  for (const h of holds) {
    const lines = ((h.cartData as any)?.cart ?? []) as { price?: number; quantity?: number }[];
    const value = Array.isArray(lines)
      ? lines.reduce((t, l) => t + Number(l.price ?? 0) * Number(l.quantity ?? 0), 0)
      : 0;
    rows.push({
      kind: 'hold',
      id: h.id,
      number: null,
      name: fullName(h.customer),
      customerId: h.customer?.id ?? null,
      at: h.createdAt.toISOString(),
      mode: null,
      amount: round2(value),
      reason: null,
      badge: 'hold',
      discountPct: null,
    });
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, take);
}

export interface StaffLine {
  userId: number;
  name: string;
  value: number;
  bills: number;
  items: number;
  upt: number | null;
  /** Returned pieces ÷ pieces sold, % (drill-down only, §7.2). */
  returnRate: number | null;
  top: boolean;
}

/**
 * §7.2: sales by the salesperson who sold the piece (`SaleItem.agentId`),
 * never the cashier: the shop has one till, so cashier ranking would be a
 * list of one. A line whose agent IS the bill's cashier is the checkout
 * default, not an attribution, and is left out.
 */
export async function staffPerformance(scope: Scope, range: DayRange): Promise<StaffLine[]> {
  const from = dateOnly(range.from);
  const to = dateOnly(range.to);
  const own = scope.ownUserId ? Prisma.sql`AND si."agentId" = ${scope.ownUserId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      si."agentId" AS uid,
      u."firstName" AS first, u."lastName" AS last,
      COALESCE(SUM(si.total), 0) AS value,
      COUNT(DISTINCT si."saleId") AS bills,
      COALESCE(SUM(si.quantity), 0) AS items,
      COALESCE(SUM(si."returnedQuantity"), 0) AS returned
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN users u ON u.id = si."agentId"
    WHERE s."branchId" = ${scope.branchId}
      AND s."businessDate" BETWEEN ${from} AND ${to}
      AND s.status <> 'void'
      AND si."agentId" IS NOT NULL
      AND si."agentId" <> s."userId"
      ${own}
    GROUP BY si."agentId", u."firstName", u."lastName"
    ORDER BY value DESC`;

  return rows.map((r, i) => {
    const bills = Number(r.bills);
    const items = Number(r.items);
    return {
      userId: Number(r.uid),
      name: `${r.first} ${r.last ?? ''}`.trim(),
      value: round2(Number(r.value)),
      bills,
      items,
      upt: bills > 0 ? round2(items / bills) : null,
      returnRate: items > 0 ? round1((Number(r.returned) / items) * 100) : null,
      top: i === 0 && rows.length > 1,
    };
  });
}

export type Tier = 'good' | 'attention' | 'critical';

export interface EodSummary {
  businessDate: string;
  sessions: number;
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  expected: number;
  counted: number;
  /** counted − expected: negative is SHORT, positive is OVER. */
  variance: number;
  status: 'balanced' | 'short' | 'over';
  tier: Tier;
  closedAt: string;
}

/**
 * §5.3 colour thresholds, as a share of the shift's cash takings with an
 * absolute floor, so ₹100 short reads differently on a ₹5,000 day and an
 * ₹80,000 one, and pocket change is never flagged.
 */
export function eodTier(variance: number, cashSales: number): Tier {
  const v = Math.abs(variance);
  const pct = cashSales > 0 ? (v / cashSales) * 100 : v > 0 ? 100 : 0;
  if (pct > 5 && v > 200) return 'critical';
  if (pct > 2 && v > 50) return 'attention';
  return 'good';
}

/**
 * §5.3: Cash in Drawer, shown only once every shift of the trading day has
 * closed. Expected and counted come from the close itself (`PosSession`), so
 * the dashboard says exactly what the till said at closing time.
 */
export async function eodSummary(scope: Scope & { ownShiftUserId?: number }, businessDate: string): Promise<EodSummary | null> {
  const day = dateOnly(businessDate);
  const sessions = await prisma.posSession.findMany({
    where: {
      branchId: scope.branchId,
      businessDate: day,
      ...(scope.ownShiftUserId ? { userId: scope.ownShiftUserId } : {}),
    },
    select: {
      id: true,
      userId: true,
      status: true,
      openingAmount: true,
      closingAmount: true,
      variance: true,
      openedAt: true,
      closedAt: true,
    },
  });
  if (sessions.length === 0 || sessions.some((s) => s.status !== 'closed')) return null;

  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const [cash] = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p JOIN sales s ON s.id = p."saleId"
    WHERE s."branchId" = ${scope.branchId} AND s."businessDate" = ${day}
      AND s."userId" IN (${Prisma.join(userIds)})
      AND p.method = 'cash' AND p.status = 'completed' AND s.status <> 'void'`;
  const refundRows = await prisma.return.findMany({
    where: { branchId: scope.branchId, businessDate: day, userId: { in: userIds } },
    select: { refundBreakup: true },
  });
  const cashRefunds = refundRows.reduce((t, r) => {
    const b = (r.refundBreakup as { method: string; amount: number }[] | null) ?? [];
    return t + b.filter((x) => x.method === 'cash').reduce((n, x) => n + Number(x.amount), 0);
  }, 0);

  const counted = sessions.reduce((t, s) => t + Number(s.closingAmount ?? 0), 0);
  // The close stores variance as expected − counted (positive = short).
  const expected = sessions.reduce((t, s) => t + Number(s.closingAmount ?? 0) + Number(s.variance ?? 0), 0);
  const variance = round2(counted - expected);
  const cashSales = Number(cash.v);
  const closedAt = sessions.map((s) => s.closedAt!).sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    businessDate,
    sessions: sessions.length,
    openingFloat: round2(sessions.reduce((t, s) => t + Number(s.openingAmount), 0)),
    cashSales: round2(cashSales),
    cashRefunds: round2(cashRefunds),
    expected: round2(expected),
    counted: round2(counted),
    variance,
    status: Math.abs(variance) < 1 ? 'balanced' : variance < 0 ? 'short' : 'over',
    tier: eodTier(variance, cashSales),
    closedAt: closedAt.toISOString(),
  };
}

export interface HourCell {
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  /** IST hour of day, 0–23 */
  hour: number;
  bills: number;
  value: number;
  /** Distinct trading days of this weekday in the window. */
  days: number;
}

/**
 * §6.1: hourly sales by weekday and IST hour over the `weeks` before
 * `beforeDay`. No chart reads this; it feeds the "no sale in a peak hour"
 * alert and the insight bar's day-of-week and slow-hour rules.
 */
export async function hourlyHistory(branchId: number, beforeDay: string, weeks: number): Promise<HourCell[]> {
  const before = dateOnly(beforeDay);
  const start = new Date(before.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<any[]>`
    WITH b AS (
      SELECT s."businessDate" AS d,
             EXTRACT(DOW FROM s."businessDate")::int AS dow,
             EXTRACT(HOUR FROM (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
             s.total
      FROM sales s
      WHERE s."branchId" = ${branchId}
        AND s."businessDate" >= ${start} AND s."businessDate" < ${before}
        AND s.status <> 'void'
    ),
    days AS (SELECT dow, COUNT(DISTINCT d) AS n FROM b GROUP BY dow)
    SELECT b.dow, b.hour, COUNT(*) AS bills, COALESCE(SUM(b.total), 0) AS value, days.n AS days
    FROM b JOIN days ON days.dow = b.dow
    GROUP BY b.dow, b.hour, days.n`;
  return rows.map((r) => ({
    dow: Number(r.dow),
    hour: Number(r.hour),
    bills: Number(r.bills),
    value: Number(r.value),
    days: Number(r.days),
  }));
}

/** Bills per IST hour on one trading day. */
export async function billsByHour(branchId: number, businessDate: string): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT EXTRACT(HOUR FROM (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int AS hour, COUNT(*) AS n
    FROM sales s
    WHERE s."branchId" = ${branchId} AND s."businessDate" = ${dateOnly(businessDate)} AND s.status <> 'void'
    GROUP BY 1`;
  return new Map(rows.map((r) => [Number(r.hour), Number(r.n)]));
}
