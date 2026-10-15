import {
  canSeeOnDashboard,
  compare,
  Comparison,
  comparePoints,
  dashboardAccess,
  DashboardElement,
  DashboardPeriod,
  OPERATIONAL_ALERT_TYPES,
  returnReasonLabel,
} from '@clothing-erp/shared';
import prisma from '../../config/database';
import { currentBusinessDateForBranch, istHour } from '../../utils/business-date';
import { ymdOf } from '../../utils/ist';
import { getSetting } from '../settings/service';
import {
  billsByHour,
  eodSummary,
  EodSummary,
  hourlyHistory,
  recentTransactions,
  RecentTransaction,
  staffPerformance,
  StaffLine,
} from './activity';
import {
  agentReturnStats,
  AlertSettings,
  DashboardAlert,
  DEFAULT_ALERT_SETTINGS,
  heldBillAlerts,
  noSalePeakAlerts,
  prioritiseAlerts,
  loyaltyExpiryAlerts,
  repeatReturnAlerts,
  returnRateAlerts,
} from './alerts';
import { chooseInsight, Insight, returnPatterns, topCategoryOnWeekday } from './insights';
import { dailyActionable } from './actionable';
import { weeklyReminder } from './inventory-reminder';
import { expiringSoon } from '../loyalty/expiry';
import {
  customerMix,
  hasTrading,
  paymentSplit,
  PaymentShare,
  periodTotals,
  PeriodTotals,
  previousTradingDay,
  refunds,
  round1,
  round2,
  Scope,
  uptBaseline,
} from './metrics';
import { DayRange, resolvePeriod, ResolvedPeriod } from './periods';

export interface DashboardViewer {
  userId: number;
  role: string;
  branchId: number;
}

export interface DashboardQuery {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

interface Compared {
  /** vs the previous period (labelled "vs yesterday" on Today). */
  prev: Comparison;
  /** vs last year; absent where §2.3 says this metric gets no YoY. */
  yoy?: Comparison;
}

export type CoverageLevel = 'ok' | 'amber' | 'red';

/** §3.1: hidden at ≥90%, amber below 90%, red below 75%. */
export function coverageLevel(pct: number | null): CoverageLevel {
  if (pct == null || pct >= 90) return 'ok';
  return pct < 75 ? 'red' : 'amber';
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/**
 * The whole dashboard for one viewer and one period, in a single response.
 *
 * Every box the viewer's role may not see (§11A) is left OUT of the payload,
 * not merely hidden by the browser. Owner-only numbers never leave the server
 * for a cashier.
 */
/** The trading day and the resolved period ranges for a viewer's branch. */
export async function resolveViewerPeriod(viewer: DashboardViewer, query: DashboardQuery) {
  const bdDate = await currentBusinessDateForBranch(prisma, viewer.branchId);
  const businessDate = ymdOf(bdDate);
  const period = resolvePeriod({
    period: query.period,
    businessDate,
    previousTradingDay: await previousTradingDay(viewer.branchId, businessDate),
    from: query.from,
    to: query.to,
  });
  return { bdDate, businessDate, period };
}

export async function getDashboard(viewer: DashboardViewer, query: DashboardQuery) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: viewer.branchId }, select: { id: true, name: true } });
  const { bdDate, businessDate, period } = await resolveViewerPeriod(viewer, query);

  const sees = (e: DashboardElement) => canSeeOnDashboard(viewer.role, e, period.period);
  const level = (e: DashboardElement) => dashboardAccess(viewer.role, e);
  const branchScope: Scope = { branchId: viewer.branchId };
  const ownScope: Scope = { branchId: viewer.branchId, ownUserId: viewer.userId };
  const scopeFor = (e: DashboardElement): Scope => (level(e) === 'own' ? ownScope : branchScope);

  // ─── Period totals, fetched once per scope that something on screen needs ───
  const needsBranchTotals = (['sales', 'profit', 'discount', 'inventorySold'] as DashboardElement[]).some(sees)
    || (sees('basket') && level('basket') !== 'own');
  const needsOwnTotals = sees('basket') && level('basket') === 'own';

  const lyHasData = period.lastYear ? await hasTrading(viewer.branchId, period.lastYear) : false;
  const lyRange = lyHasData ? period.lastYear : null;

  const totalsFor = async (scope: Scope) => {
    const [cur, prev, ly] = await Promise.all([
      periodTotals(scope, period.current),
      periodTotals(scope, period.previous),
      lyRange ? periodTotals(scope, lyRange) : Promise.resolve(null),
    ]);
    return { cur, prev, ly };
  };
  const [branchT, ownT] = await Promise.all([
    needsBranchTotals ? totalsFor(branchScope) : Promise.resolve(null),
    needsOwnTotals ? totalsFor(ownScope) : Promise.resolve(null),
  ]);

  const out: Record<string, unknown> = {
    meta: {
      storeName: branch.name,
      branchId: branch.id,
      businessDate,
      period: period.period,
      range: period.current,
      previousRange: period.previous,
      lastYearRange: period.lastYear,
      hasLastYear: lyHasData,
      generatedAt: new Date().toISOString(),
      role: viewer.role,
    },
  };

  // ─── Row 1: sales trio (§3) ───
  if (sees('sales') && branchT) {
    const { cur, prev, ly } = branchT;
    const abv = (t: PeriodTotals | null) => (t ? ratio(t.totalSales, t.bills) : null);
    out.sales = {
      totalSales: cur.totalSales,
      bills: cur.bills,
      avgBill: round2(abv(cur) ?? 0),
      compare: {
        totalSales: withYoy(compare(cur.totalSales, prev.totalSales), lyRange, () => compare(cur.totalSales, ly!.totalSales)),
        bills: withYoy(compare(cur.bills, prev.bills), lyRange, () => compare(cur.bills, ly!.bills)),
        avgBill: withYoy(compare(abv(cur), abv(prev)), lyRange, () => compare(abv(cur), abv(ly))),
      },
    };
  }

  // ─── Gross profit & margin (§3.1, §12.3) ───
  if (sees('profit') && branchT) {
    const { cur, prev, ly } = branchT;
    const margin = (t: PeriodTotals | null) => (t && t.costedSales > 0 ? (t.grossProfit / t.costedSales) * 100 : null);
    const coverage = cur.totalSales > 0 ? round1(Math.min(100, (cur.costedSales / cur.totalSales) * 100)) : null;
    out.profit = {
      grossProfit: cur.grossProfit,
      marginPct: margin(cur) != null ? round1(margin(cur)!) : null,
      costedSales: cur.costedSales,
      totalSales: cur.totalSales,
      coveragePct: coverage,
      coverageLevel: coverageLevel(coverage),
      uncostedLines: cur.uncostedLines,
      compare: {
        grossProfit: withYoy(compare(cur.grossProfit, prev.grossProfit), lyRange, () => compare(cur.grossProfit, ly!.grossProfit)),
        marginPct: withYoy(comparePoints(margin(cur), margin(prev)), lyRange, () => comparePoints(margin(cur), margin(ly))),
      },
    };
  }

  // ─── Basket strip (§4) ───
  if (sees('basket')) {
    const t = level('basket') === 'own' ? ownT : branchT;
    if (t) {
      const upt = (x: PeriodTotals | null) => (x ? ratio(x.items, x.bills) : null);
      const aiv = (x: PeriodTotals | null) => (x ? ratio(x.totalSales, x.items) : null);
      const baseline = await uptBaseline(scopeFor('basket'), period.current.from);
      out.basket = {
        upt: upt(t.cur) != null ? round2(upt(t.cur)!) : null,
        avgItemValue: aiv(t.cur) != null ? round2(aiv(t.cur)!) : null,
        items: t.cur.items,
        uptBaseline8w: baseline,
        compare: {
          upt: withYoy(compare(upt(t.cur), upt(t.prev)), level('basket') === 'own' ? null : lyRange, () => compare(upt(t.cur), upt(t.ly))),
          uptVsBaseline: baseline != null ? compare(upt(t.cur), baseline) : null,
          avgItemValue: { prev: compare(aiv(t.cur), aiv(t.prev)) },
        },
        ownOnly: level('basket') === 'own',
      };
    }
  }

  // ─── Row 2: returns, customers, discount (§5) ───
  const [retCur, retPrev, custCur, custPrev, custLy, split] = await Promise.all([
    sees('returns') ? refunds(scopeFor('returns'), period.current) : null,
    sees('returns') ? refunds(scopeFor('returns'), period.previous) : null,
    sees('customers') ? customerMix(branchScope, period.current) : null,
    sees('customers') ? customerMix(branchScope, period.previous) : null,
    sees('customers') && lyRange ? customerMix(branchScope, lyRange) : null,
    sees('paymentSplit') ? paymentSplit(branchScope, period.current) : null,
  ]);

  if (retCur && retPrev) {
    out.returns = {
      count: retCur.count,
      value: retCur.value,
      exchanges: retCur.exchanges,
      topReasons: retCur.reasons.slice(0, 2).map((r) => ({ ...r, label: returnReasonLabel(r.code) })),
      reasons: retCur.reasons.map((r) => ({ ...r, label: returnReasonLabel(r.code) })),
      // Fewer returns is better; no YoY by design (§2.3).
      compare: {
        count: { prev: compare(retCur.count, retPrev.count, { higherIsBetter: false }) },
        value: { prev: compare(retCur.value, retPrev.value, { higherIsBetter: false }) },
      },
      ownOnly: level('returns') === 'own',
    };
  }

  if (custCur && custPrev) {
    out.customers = {
      ...custCur,
      compare: {
        identified: { prev: compare(custCur.identified, custPrev.identified) },
        walkIns: { prev: compare(custCur.walkIns, custPrev.walkIns) },
        returningPct: withYoy(
          comparePoints(custCur.returningPct, custPrev.returningPct),
          custLy && custLy.identified > 0 ? lyRange : null,
          () => comparePoints(custCur.returningPct, custLy!.returningPct)
        ),
      },
    };
  }

  if (sees('discount') && branchT) {
    const { cur, prev } = branchT;
    const pct = (t: PeriodTotals) => (t.preDiscount > 0 ? (t.discount / t.preDiscount) * 100 : null);
    out.discount = {
      value: round2(cur.discount),
      pctOfGross: pct(cur) != null ? round1(pct(cur)!) : null,
      // More discount is worse; no YoY by design (§2.3).
      compare: {
        value: { prev: compare(cur.discount, prev.discount, { higherIsBetter: false }) },
        pct: { prev: comparePoints(pct(cur), pct(prev), { higherIsBetter: false }) },
      },
    };
  }

  if (split) out.paymentSplit = split satisfies PaymentShare[];

  // ─── Inventory value sold at cost (§G) ───
  if (sees('inventorySold') && branchT) {
    out.inventorySold = {
      valueAtCost: branchT.cur.costOfGoods,
      uncostedLines: branchT.cur.uncostedLines,
      compare: { prev: compare(branchT.cur.costOfGoods, branchT.prev.costOfGoods) },
    };
  }

  // ─── Bottom row: recent transactions and staff (§7) ───
  if (sees('recentTransactions')) {
    const lvl = level('recentTransactions');
    out.recentTransactions = (await recentTransactions(lvl === 'own' ? ownScope : branchScope, {
      limit: 8,
      onlyDay: lvl === 'today' ? businessDate : undefined,
    })) satisfies RecentTransaction[];
  }

  if (sees('staff')) {
    const lvl = level('staff');
    // A cashier sees their own line; a supervisor sees today's floor, the
    // shift they run; owner and manager see the whole period.
    const lines: StaffLine[] =
      lvl === 'own'
        ? await staffPerformance(ownScope, period.current)
        : lvl === 'ownShift'
        ? await staffPerformance(branchScope, { from: businessDate, to: businessDate })
        : await staffPerformance(branchScope, period.current);
    out.staff = { lines, ownOnly: lvl === 'own' };
  }

  // ─── Alerts and the insight bar (§8, §9) ───
  let alerts: DashboardAlert[] = [];
  if (sees('alerts') || sees('insight')) {
    const settings = await getSetting<AlertSettings>('dashboardAlerts', DEFAULT_ALERT_SETTINGS);
    const dismissed = await loadDismissed(viewer.branchId);
    const dow = bdDate.getUTCDay();
    const openShift = await prisma.posSession.findFirst({
      where: { branchId: viewer.branchId, status: 'open', businessDate: bdDate },
      orderBy: { openedAt: 'asc' },
      select: { openedAt: true },
    });
    const alertSettings = { ...DEFAULT_ALERT_SETTINGS, ...settings };
    const [held, repeat, agentStats, hourly8w, todayByHour, expiring] = await Promise.all([
      heldBillAlerts(viewer.branchId, alertSettings),
      repeatReturnAlerts(viewer.branchId, businessDate),
      agentReturnStats(viewer.branchId, businessDate),
      hourlyHistory(viewer.branchId, businessDate, 8),
      billsByHour(viewer.branchId, businessDate),
      expiringSoon(alertSettings.loyaltyExpiryDays),
    ]);
    const all: DashboardAlert[] = [
      ...repeat,
      ...returnRateAlerts(agentStats, businessDate),
      ...noSalePeakAlerts({
        history: hourly8w,
        dow,
        businessDate,
        todayByHour,
        nowHour: openShift ? istHour(new Date()) : null,
        openedHour: openShift ? istHour(openShift.openedAt) : null,
      }),
      ...held,
      ...loyaltyExpiryAlerts(expiring.length, alertSettings.loyaltyExpiryDays, businessDate),
    ];
    const visibleTypes =
      level('alerts') === 'operational' ? new Set<string>(OPERATIONAL_ALERT_TYPES) : null;
    alerts = prioritiseAlerts(
      all.filter((a) => !visibleTypes || visibleTypes.has(a.type)),
      dismissed
    );
    if (sees('alerts')) out.alerts = alerts;

    if (sees('insight')) {
      const [patterns, hourly4w, topCat] = await Promise.all([
        returnPatterns(viewer.branchId, businessDate),
        hourlyHistory(viewer.branchId, businessDate, 4),
        topCategoryOnWeekday(viewer.branchId, businessDate, (dow + 1) % 7),
      ]);
      const insight: Insight | null = chooseInsight({
        businessDate,
        dow,
        returnPatterns: patterns,
        yoy:
          branchT && branchT.ly && lyRange
            ? { current: branchT.cur.totalSales, lastYear: branchT.ly.totalSales, periodLabel: periodPhrase(period) }
            : null,
        hourly8w,
        hourly4w,
        topCategoryTomorrow: topCat,
        loyaltyExpiringCustomers: expiring.length,
        activeAlerts: alerts,
        dismissed,
      });
      out.insight = insight;
    }
  }

  // ─── Daily Actionable and the weekly inventory reminder (§15) ───
  if (sees('actionable')) {
    out.actionable = await dailyActionable(viewer.branchId, businessDate);
  }
  if (sees('weeklyInventory')) {
    const weekly = await weeklyReminder(viewer.branchId, businessDate);
    const dismissed = await loadDismissed(viewer.branchId);
    out.weeklyInventory = dismissed.has(weekly.dismissKey) ? null : weekly;
  }

  // ─── End of day cash (§5.3) ───
  if (sees('eod') && period.period === 'today') {
    const eod: EodSummary | null = await eodSummary(
      { ...branchScope, ownShiftUserId: level('eod') === 'ownShift' ? viewer.userId : undefined },
      businessDate
    );
    out.eod = eod;
  }

  out.access = Object.fromEntries(
    (
      [
        'sales', 'profit', 'basket', 'returns', 'customers', 'discount', 'paymentSplit', 'recentTransactions',
        'staff', 'alerts', 'insight', 'inventorySold', 'eod', 'actionable', 'weeklyInventory',
      ] as DashboardElement[]
    ).map((e) => [e, sees(e) ? level(e) : 'hidden'])
  );

  return out;
}

function withYoy(prev: Comparison, lyRange: DayRange | null, yoy: () => Comparison): Compared {
  return lyRange ? { prev, yoy: yoy() } : { prev, yoy: { pct: null, delta: null, direction: null, good: null, noData: true } };
}

function periodPhrase(p: ResolvedPeriod): string {
  switch (p.period) {
    case 'today':
      return 'today';
    case 'week':
      return 'this week';
    case 'month':
      return 'this month';
    default:
      return 'over this period';
  }
}

async function loadDismissed(branchId: number): Promise<Set<string>> {
  const since = new Date(Date.now() - 45 * 24 * 3600_000);
  const rows = await prisma.dashboardDismissal.findMany({
    where: { branchId, dismissedAt: { gte: since } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

/**
 * Owner/Manager dismiss an alert, the insight or the weekly reminder. Keys are
 * occurrence-specific, so the next occurrence shows again on its own.
 */
export async function dismiss(viewer: DashboardViewer, key: string) {
  await prisma.dashboardDismissal.upsert({
    where: { branchId_key: { branchId: viewer.branchId, key } },
    create: { branchId: viewer.branchId, key, dismissedBy: viewer.userId },
    update: {},
  });
}

const LAYOUT_KEYS = { desktop: 'dashboard.layout.desktop', mobile: 'dashboard.layout.mobile' } as const;

/** §1.3b: a saved layout per user, desktop and mobile kept separately. */
export async function getLayout(userId: number, device: keyof typeof LAYOUT_KEYS) {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: LAYOUT_KEYS[device] } },
    select: { value: true, updatedAt: true },
  });
  return row ? { layout: row.value, updatedAt: row.updatedAt } : { layout: null, updatedAt: null };
}

export async function saveLayout(userId: number, device: keyof typeof LAYOUT_KEYS, layout: unknown) {
  const key = LAYOUT_KEYS[device];
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value: layout as any },
    update: { value: layout as any },
  });
}

export async function resetLayout(userId: number, device: keyof typeof LAYOUT_KEYS) {
  await prisma.userPreference.deleteMany({ where: { userId, key: LAYOUT_KEYS[device] } });
}

