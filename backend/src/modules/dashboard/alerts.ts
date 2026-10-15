import prisma from '../../config/database';
import { dateOnly } from '../../utils/ist';
import { HourCell } from './activity';
import { addDays } from './periods';
import { round1 } from './metrics';

/**
 * Dashboard spec §8: the five Active Alerts. Low and stagnant stock are
 * deliberately NOT here (§1.2): with one piece per size they would be on
 * permanently and the panel would stop being read.
 *
 * The rules are pure functions over plain inputs (tested without a database);
 * the loaders below only fetch those inputs.
 */

export type AlertSeverity = 'red' | 'amber' | 'blue' | 'purple';
export type AlertType = 'return_rate' | 'held_bill' | 'loyalty_expiring' | 'no_sale_peak' | 'repeat_return_sku';

export interface DashboardAlert {
  /** Stable for one occurrence; dismissing stores this key. */
  key: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** What the side panel opens on. */
  subject: { kind: 'held' | 'product' | 'user' | 'loyalty' | 'hour'; id: number } | null;
}

/** §8.1: at most five, Red → Amber → Blue → Purple. */
export const MAX_ALERTS = 5;
const SEVERITY_ORDER: Record<AlertSeverity, number> = { red: 0, amber: 1, blue: 2, purple: 3 };

export function prioritiseAlerts(alerts: DashboardAlert[], dismissed: Set<string>): DashboardAlert[] {
  return alerts
    .filter((a) => !dismissed.has(a.key))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_ALERTS);
}

export interface AlertSettings {
  /** Alert #2 fires once a parked bill is older than this. */
  heldBillHours: number;
  /** Alert #3 looks this many days ahead for expiring points. */
  loyaltyExpiryDays: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { heldBillHours: 2, loyaltyExpiryDays: 7 };

const hourLabel = (h: number) => {
  const fmt = (x: number) => `${((x + 11) % 12) + 1}${x < 12 || x === 24 ? 'am' : 'pm'}`;
  return `${fmt(h)}–${fmt(h + 1)}`;
};

/**
 * Alert #4: a historically busy hour went by with no bill.
 *
 * Busy = one of the three hours with the most bills on this weekday over the
 * last 8 weeks. Needs at least four of those weekdays on record, or "usually
 * busy" is a guess. Fires only for an hour that has fully passed while the
 * shop was open, so it never fires at 6:05 pm for a 6–7 pm hour.
 */
export function noSalePeakAlerts(input: {
  history: HourCell[];
  dow: number;
  businessDate: string;
  todayByHour: Map<number, number>;
  /** Current IST hour if today is still trading, else null (no alert after close). */
  nowHour: number | null;
  /** IST hour the shift opened today. */
  openedHour: number | null;
}): DashboardAlert[] {
  const { history, dow, todayByHour, nowHour, openedHour } = input;
  if (nowHour == null || openedHour == null) return [];
  const cells = history.filter((c) => c.dow === dow && c.days >= 4);
  if (cells.length === 0) return [];
  const peaks = [...cells].sort((a, b) => b.bills - a.bills).slice(0, 3);
  return peaks
    .filter((c) => c.hour >= openedHour && c.hour < nowHour && (todayByHour.get(c.hour) ?? 0) === 0)
    .map((c) => {
      const usual = round1(c.bills / c.days);
      return {
        key: `alert:no_sale:${input.businessDate}:${c.hour}`,
        type: 'no_sale_peak' as const,
        severity: 'amber' as const,
        title: `No sale ${hourLabel(c.hour)}`,
        detail: `Usually one of the busiest hours on this day (about ${usual} bills).`,
        subject: { kind: 'hour' as const, id: c.hour },
      };
    });
}

export interface AgentReturnStats {
  userId: number;
  name: string;
  /** Distinct bills carrying this person's lines in the 7 days. */
  bills: number;
  sold: number;
  returned: number;
}

/** Alert #1: 7-day return rate above 15% on at least 20 bills (§8). */
export function returnRateAlerts(stats: AgentReturnStats[], businessDate: string): DashboardAlert[] {
  return stats
    .filter((s) => s.bills >= 20 && s.sold > 0 && (s.returned / s.sold) * 100 > 15)
    .map((s) => ({
      key: `alert:return_rate:${s.userId}:${businessDate}`,
      type: 'return_rate' as const,
      severity: 'amber' as const,
      title: `High return rate: ${s.name}`,
      detail: `${round1((s.returned / s.sold) * 100)}% of pieces came back in 7 days (${s.returned} of ${s.sold}).`,
      subject: { kind: 'user' as const, id: s.userId },
    }));
}

// ─── Loaders ────────────────────────────────────────────────────────────────

/** Alert #2: parked bills older than the threshold. */
export async function heldBillAlerts(branchId: number, settings: AlertSettings, now = new Date()): Promise<DashboardAlert[]> {
  const cutoff = new Date(now.getTime() - settings.heldBillHours * 3600_000);
  const held = await prisma.heldTransaction.findMany({
    where: {
      branchId,
      createdAt: { lt: cutoff },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true, customer: { select: { firstName: true, lastName: true } } },
  });
  return held.map((h) => {
    const hours = Math.floor((now.getTime() - h.createdAt.getTime()) / 3600_000);
    const who = h.customer ? `${h.customer.firstName} ${h.customer.lastName ?? ''}`.trim() : 'a walk-in';
    return {
      key: `alert:held:${h.id}`,
      type: 'held_bill' as const,
      severity: 'blue' as const,
      title: `Held bill over ${hours} hr${hours === 1 ? '' : 's'}`,
      detail: `Parked for ${who}. Resume billing or void it.`,
      subject: { kind: 'held' as const, id: h.id },
    };
  });
}

/**
 * Alert #5: the same article came back twice or more in 7 days (refunds and
 * swaps alike): a likely quality problem. Grouped by article, not by size
 * variant: with one piece per size, a defective style comes back as
 * different sizes.
 */
export async function repeatReturnAlerts(branchId: number, businessDate: string): Promise<DashboardAlert[]> {
  const from = dateOnly(addDays(businessDate, -6));
  const to = dateOnly(businessDate);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT p.id, p.name, SUM(ri.quantity) AS n
    FROM return_items ri
    JOIN returns r ON r.id = ri."returnId"
    JOIN product_variants v ON v.id = ri."variantId"
    JOIN products p ON p.id = v."productId"
    WHERE r."branchId" = ${branchId} AND r."businessDate" BETWEEN ${from} AND ${to} AND r.status = 'completed'
    GROUP BY p.id, p.name
    HAVING SUM(ri.quantity) >= 2
    ORDER BY n DESC`;
  return rows.map((r) => ({
    key: `alert:repeat_return:${r.id}:${businessDate}`,
    type: 'repeat_return_sku' as const,
    severity: 'red' as const,
    title: `Repeat return: ${r.name}`,
    detail: `Returned ${Number(r.n)} times in 7 days. Check for a quality defect.`,
    subject: { kind: 'product' as const, id: Number(r.id) },
  }));
}

/** Inputs for alert #1, attributed the same way as Staff Performance (§7.2). */
export async function agentReturnStats(branchId: number, businessDate: string): Promise<AgentReturnStats[]> {
  const from = dateOnly(addDays(businessDate, -6));
  const to = dateOnly(businessDate);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT si."agentId" AS uid, u."firstName" AS first, u."lastName" AS last,
           COUNT(DISTINCT si."saleId") AS bills,
           COALESCE(SUM(si.quantity), 0) AS sold,
           COALESCE(SUM(si."returnedQuantity"), 0) AS returned
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN users u ON u.id = si."agentId"
    WHERE s."branchId" = ${branchId} AND s."businessDate" BETWEEN ${from} AND ${to}
      AND s.status <> 'void' AND si."agentId" IS NOT NULL AND si."agentId" <> s."userId"
    GROUP BY si."agentId", u."firstName", u."lastName"`;
  return rows.map((r) => ({
    userId: Number(r.uid),
    name: `${r.first} ${r.last ?? ''}`.trim(),
    bills: Number(r.bills),
    sold: Number(r.sold),
    returned: Number(r.returned),
  }));
}

/** Alert #3: customers whose points lapse within the window (§8). */
export function loyaltyExpiryAlerts(customers: number, days: number, businessDate: string): DashboardAlert[] {
  if (customers <= 0) return [];
  return [
    {
      key: `alert:loyalty:${businessDate}`,
      type: 'loyalty_expiring',
      severity: 'purple',
      title: `Loyalty points expiring: ${customers} customer${customers === 1 ? '' : 's'}`,
      detail: `Points lapse within ${days} days. A reminder brings them back in.`,
      subject: { kind: 'loyalty', id: 0 },
    },
  ];
}
