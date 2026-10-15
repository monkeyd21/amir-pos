import prisma from '../../config/database';
import { formatInr } from '@clothing-erp/shared';
import { dateOnly } from '../../utils/ist';
import { HourCell } from './activity';
import { DashboardAlert } from './alerts';
import { addDays } from './periods';

/**
 * Dashboard spec §9, Phase 1: one recommendation at a time, from fixed rules
 * over the same numbers the cards show. No model, no timer: the answer is
 * recomputed on every load, so it "refreshes" when something meaningful
 * happens or when the current one is dismissed (the next rule gets its turn).
 *
 * §8.1: an insight that would repeat an active alert is skipped. Today that
 * is the return pattern, which the repeat-return alert already covers.
 */

export type InsightType = 'return_pattern' | 'day_of_week' | 'yoy_milestone' | 'slow_hour' | 'loyalty_nudge';

export interface Insight {
  key: string;
  type: InsightType;
  text: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const hour12 = (h: number) => `${((h + 11) % 12) + 1}${h < 12 || h === 24 ? 'am' : 'pm'}`;

export interface InsightInputs {
  businessDate: string;
  /** Weekday (0 = Sunday) of the trading day. */
  dow: number;
  /** Return pattern candidates: articles with 3+ pieces back this week. */
  returnPatterns: { productId: number; name: string; count: number }[];
  /** Period sales against last year's same period, or null with no LY data. */
  yoy: { current: number; lastYear: number; periodLabel: string } | null;
  /** Last 8 weeks, by weekday and hour. */
  hourly8w: HourCell[];
  /** Last 4 weeks, by weekday and hour. */
  hourly4w: HourCell[];
  /** The category that sells best on tomorrow's weekday. */
  topCategoryTomorrow: string | null;
  loyaltyExpiringCustomers: number;
  activeAlerts: DashboardAlert[];
  dismissed: Set<string>;
}

/** Average takings per trading day of each weekday. */
function dailyAverageByWeekday(cells: HourCell[]): Map<number, number> {
  const byDow = new Map<number, { value: number; days: number }>();
  for (const c of cells) {
    const e = byDow.get(c.dow) ?? { value: 0, days: c.days };
    e.value += c.value;
    e.days = Math.max(e.days, c.days);
    byDow.set(c.dow, e);
  }
  const out = new Map<number, number>();
  for (const [dow, e] of byDow) if (e.days >= 4) out.set(dow, e.value / e.days);
  return out;
}

export function candidateInsights(i: InsightInputs): Insight[] {
  const out: Insight[] = [];

  // Return pattern, unless the alert panel is already saying it (§8.1).
  const alerted = new Set(
    i.activeAlerts.filter((a) => a.type === 'repeat_return_sku' && a.subject).map((a) => a.subject!.id)
  );
  const pattern = i.returnPatterns.find((p) => !alerted.has(p.productId));
  if (pattern) {
    out.push({
      key: `insight:return_pattern:${pattern.productId}:${i.businessDate}`,
      type: 'return_pattern',
      text: `${pattern.count} returns of ${pattern.name} this week. Worth a quality check before it goes back on the rail.`,
    });
  }

  // Tomorrow is a strong day: prepare tonight.
  const avg = dailyAverageByWeekday(i.hourly8w);
  if (avg.size >= 5) {
    const tomorrow = (i.dow + 1) % 7;
    // Against the OTHER weekdays: folding tomorrow into the average would
    // understate exactly the lift being reported.
    const others = [...avg.entries()].filter(([d]) => d !== tomorrow).map(([, v]) => v);
    const mean = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
    const t = avg.get(tomorrow);
    if (t != null && mean > 0) {
      const lift = Math.round(((t - mean) / mean) * 100);
      if (lift >= 20) {
        const stock = i.topCategoryTomorrow ? ` Stock up ${i.topCategoryTomorrow} tonight.` : ' Worth preparing the floor tonight.';
        out.push({
          key: `insight:day_of_week:${i.businessDate}`,
          type: 'day_of_week',
          text: `${DAY_NAMES[tomorrow]}s run ${lift}% above other days.${stock}`,
        });
      }
    }
  }

  // Comfortably ahead of last year.
  if (i.yoy && i.yoy.lastYear > 0) {
    const ahead = Math.round(((i.yoy.current - i.yoy.lastYear) / i.yoy.lastYear) * 100);
    if (ahead >= 10) {
      out.push({
        key: `insight:yoy:${i.yoy.periodLabel}:${i.businessDate}`,
        type: 'yoy_milestone',
        text: `${ahead}% ahead of last year ${i.yoy.periodLabel} (${formatInr(i.yoy.current)} against ${formatInr(i.yoy.lastYear)}).`,
      });
    }
  }

  // The quietest two-hour stretch, from four weeks of hourly data.
  const byHour = new Map<number, number>();
  for (const c of i.hourly4w) byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.bills);
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  if (hours.length >= 6) {
    // Opening and closing hours are quiet by nature, so they are not candidates:
    // the useful answer is the slow stretch in the middle of a trading day.
    const first = hours[0];
    const last = hours[hours.length - 1];
    let best: { start: number; bills: number } | null = null;
    for (let h = first + 1; h + 1 < last; h++) {
      if (!byHour.has(h) || !byHour.has(h + 1)) continue;
      const bills = byHour.get(h)! + byHour.get(h + 1)!;
      if (!best || bills < best.bills) best = { start: h, bills };
    }
    if (best) {
      out.push({
        key: `insight:slow_hour:${best.start}:${addDays(i.businessDate, -((i.dow + 6) % 7))}`,
        type: 'slow_hour',
        text: `${hour12(best.start)}–${hour12(best.start + 2)} is the slowest stretch of the day. A good window for breaks, steaming and re-merchandising.`,
      });
    }
  }

  // §8.1: the purple alert already says this; the bar would only repeat it.
  const loyaltyAlerted = i.activeAlerts.some((a) => a.type === 'loyalty_expiring');
  if (i.loyaltyExpiringCustomers > 0 && !loyaltyAlerted) {
    out.push({
      key: `insight:loyalty:${i.businessDate}`,
      type: 'loyalty_nudge',
      text: `${i.loyaltyExpiringCustomers} customer${i.loyaltyExpiringCustomers === 1 ? ' has' : 's have'} points expiring this week. A WhatsApp nudge brings them in.`,
    });
  }

  return out.filter((x) => !i.dismissed.has(x.key));
}

/** The one insight to show, or null. */
export function chooseInsight(i: InsightInputs): Insight | null {
  return candidateInsights(i)[0] ?? null;
}

// ─── Loaders ────────────────────────────────────────────────────────────────

export async function returnPatterns(branchId: number, businessDate: string) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT p.id, p.name, SUM(ri.quantity) AS n
    FROM return_items ri
    JOIN returns r ON r.id = ri."returnId"
    JOIN product_variants v ON v.id = ri."variantId"
    JOIN products p ON p.id = v."productId"
    WHERE r."branchId" = ${branchId}
      AND r."businessDate" BETWEEN ${dateOnly(addDays(businessDate, -6))} AND ${dateOnly(businessDate)}
      AND r.status = 'completed'
    GROUP BY p.id, p.name
    HAVING SUM(ri.quantity) >= 3
    ORDER BY n DESC
    LIMIT 3`;
  return rows.map((r) => ({ productId: Number(r.id), name: String(r.name), count: Number(r.n) }));
}

/** The category with the most takings on `dow` over the last 8 weeks. */
export async function topCategoryOnWeekday(branchId: number, businessDate: string, dow: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT c.name, SUM(si.total) AS v
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN product_variants pv ON pv.id = si."variantId"
    JOIN products p ON p.id = pv."productId"
    JOIN categories c ON c.id = p."categoryId"
    WHERE s."branchId" = ${branchId}
      AND s."businessDate" >= ${dateOnly(addDays(businessDate, -56))} AND s."businessDate" < ${dateOnly(businessDate)}
      AND EXTRACT(DOW FROM s."businessDate") = ${dow}
      AND s.status <> 'void'
    GROUP BY c.name
    ORDER BY v DESC
    LIMIT 1`;
  return rows[0]?.name ?? null;
}
