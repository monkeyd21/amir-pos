import prisma from '../../config/database';
import { dateOnly, ymdOf } from '../../utils/ist';
import { daysBetween } from './periods';
import { round2 } from './metrics';
import type { Tier } from './activity';

/**
 * Dashboard spec §15: the Daily Actionable widget. Five cross-module gaps that
 * quietly break Payroll, Expenses and Cash Flow if left unfilled. It only
 * reads the source modules (Employees, Payables, Payroll, Pending Sales, UPI
 * credits) and never keeps a copy; its quick actions write through those
 * modules' own APIs. It NEVER blocks billing (§15.4): it is a nudge, not a gate.
 */

export type ItemState = 'done' | 'pending' | 'hidden';

export interface ActionableItem {
  key: 'attendance' | 'expenses' | 'salary' | 'pending_sales' | 'upi';
  state: ItemState;
  tier: Tier;
  label: string;
  detail: string | null;
}

// ─── Pure escalation rules (§15.3) ──────────────────────────────────────────

/** Attendance and expenses: a warning colour once it has gone 2+ trading days. */
export function streakTier(pendingDays: number): Tier {
  return pendingDays >= 2 ? 'attention' : 'good';
}

/** Pending sales: by the age of the oldest one, in trading days. */
export function pendingSalesTier(count: number, oldestAgeDays: number): Tier {
  if (count === 0) return 'good';
  if (oldestAgeDays > 3) return 'critical';
  if (oldestAgeDays > 1) return 'attention';
  return 'good';
}

/** Salary run: attention on the pay date, critical three or more days after it. */
export function salaryTier(daysPastPayDate: number): Tier {
  return daysPastPayDate >= 3 ? 'critical' : 'attention';
}

/** The month whose salary run is due on `businessDate`, if any (pay date = last day of the month). */
export function salaryMonthDue(businessDate: string): { month: string; payDate: string } | null {
  const [y, m] = businessDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const thisMonth = businessDate.slice(0, 7);
  const thisPayDate = `${thisMonth}-${String(lastDay).padStart(2, '0')}`;
  if (businessDate >= thisPayDate) return { month: thisMonth, payDate: thisPayDate };
  // Before this month's pay date: last month's run may still be open.
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevMonth = prev.toISOString().slice(0, 7);
  const prevLast = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate();
  return { month: prevMonth, payDate: `${prevMonth}-${String(prevLast).padStart(2, '0')}` };
}

// ─── Loaders ────────────────────────────────────────────────────────────────

/** Trading days (days the branch had a shift) up to and including `businessDate`, newest first. */
async function recentTradingDays(branchId: number, businessDate: string, n: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT "businessDate" AS d FROM pos_sessions
    WHERE "branchId" = ${branchId} AND "businessDate" IS NOT NULL AND "businessDate" <= ${dateOnly(businessDate)}
    ORDER BY d DESC LIMIT ${n}`;
  const days = rows.map((r) => ymdOf(new Date(r.d)));
  return days.includes(businessDate) ? days : [businessDate, ...days].slice(0, n);
}

/** Active staff who should have an attendance mark on `day` (joined by then, not the owner). */
async function staffDue(branchId: number, day: string) {
  return prisma.user.findMany({
    where: {
      branchId,
      isActive: true,
      role: { not: 'owner' },
      OR: [{ joiningDate: null }, { joiningDate: { lte: dateOnly(day) } }],
    },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: 'asc' },
  });
}

export async function attendanceGap(branchId: number, day: string) {
  const staff = await staffDue(branchId, day);
  const marks = await prisma.attendance.findMany({
    where: { date: dateOnly(day), userId: { in: staff.map((s) => s.id) } },
    select: { userId: true, status: true },
  });
  const marked = new Map(marks.map((m) => [m.userId, m.status]));
  return { staff, marked, missing: staff.filter((s) => !marked.has(s.id)) };
}

async function expenseDone(branchId: number, day: string): Promise<boolean> {
  const d = dateOnly(day);
  const from = new Date(d.getTime() - 5.5 * 3600_000); // IST midnight
  const to = new Date(from.getTime() + 24 * 3600_000);
  const [mark, expense] = await Promise.all([
    prisma.expenseDayMark.findUnique({ where: { branchId_businessDate: { branchId, businessDate: d } } }),
    prisma.payable.findFirst({
      where: {
        branchId,
        source: 'adhoc_expense',
        status: { not: 'void' },
        OR: [{ dueDate: d }, { createdAt: { gte: from, lt: to } }],
      },
      select: { id: true },
    }),
  ]);
  return Boolean(mark || expense);
}

async function streak(days: string[], check: (day: string) => Promise<boolean>): Promise<number> {
  let n = 0;
  for (const day of days) {
    if (await check(day)) break;
    n++;
  }
  return n;
}

/** "3 days", or "10+ days" when the gap runs past the look-back window. */
const daysText = (n: number, window: number) => `${n}${n >= window ? '+' : ''} days`;
const LOOKBACK = 10;

export async function dailyActionable(branchId: number, businessDate: string): Promise<{ items: ActionableItem[] }> {
  const days = await recentTradingDays(branchId, businessDate, LOOKBACK);

  // Attendance
  const att = await attendanceGap(branchId, businessDate);
  const attStreak = await streak(days, async (d) => (await attendanceGap(branchId, d)).missing.length === 0);
  const attendance: ActionableItem =
    att.staff.length === 0
      ? { key: 'attendance', state: 'hidden', tier: 'good', label: 'Attendance', detail: null }
      : att.missing.length === 0
      ? { key: 'attendance', state: 'done', tier: 'good', label: 'Attendance marked', detail: null }
      : {
          key: 'attendance',
          state: 'pending',
          tier: streakTier(attStreak),
          label: attStreak >= 2 ? `Attendance pending: ${daysText(attStreak, days.length)}` : 'Attendance pending',
          detail: `${att.missing.length} of ${att.staff.length} not marked today`,
        };

  // Variable expenses
  const expStreak = await streak(days, (d) => expenseDone(branchId, d));
  const expenses: ActionableItem =
    expStreak === 0
      ? { key: 'expenses', state: 'done', tier: 'good', label: 'Expenses entered', detail: null }
      : {
          key: 'expenses',
          state: 'pending',
          tier: streakTier(expStreak),
          label: expStreak >= 2 ? `Variable expenses: not entered for ${daysText(expStreak, days.length)}` : 'Variable expenses: not entered',
          detail: 'Add today’s, or mark No Expense Today',
        };

  // Salary run
  const due = salaryMonthDue(businessDate)!;
  const salaried = await prisma.user.findMany({
    where: { branchId, isActive: true, salaryType: { not: null }, role: { not: 'owner' } },
    select: { id: true },
  });
  const settled = await prisma.salaryPeriod.count({
    where: { month: due.month, userId: { in: salaried.map((u) => u.id) }, status: { in: ['finalised', 'paid'] } },
  });
  const salaryOpen = salaried.length > 0 && settled < salaried.length && businessDate >= due.payDate;
  const salary: ActionableItem = salaryOpen
    ? {
        key: 'salary',
        state: 'pending',
        tier: salaryTier(daysBetween(due.payDate, businessDate)),
        label: `Salary run pending (${new Date(`${due.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })})`,
        detail: `${salaried.length - settled} of ${salaried.length} not finalised`,
      }
    : { key: 'salary', state: 'hidden', tier: 'good', label: 'Salary run', detail: null };

  // Pending sales to bill
  const pend = await prisma.pendingSale.findMany({
    where: { branchId, status: 'pending' },
    select: { amountReceived: true, businessDate: true },
    orderBy: { businessDate: 'asc' },
  });
  const oldestAge = pend.length ? daysBetween(ymdOf(pend[0].businessDate), businessDate) : 0;
  const pendValue = round2(pend.reduce((t, p) => t + Number(p.amountReceived), 0));
  const pendingSales: ActionableItem = pend.length
    ? {
        key: 'pending_sales',
        state: 'pending',
        tier: pendingSalesTier(pend.length, oldestAge),
        label: `Pending sales to bill: ${pend.length}`,
        detail: `₹${pendValue.toLocaleString('en-IN')} · oldest ${oldestAge === 0 ? 'today' : `${oldestAge} day${oldestAge === 1 ? '' : 's'}`}`,
      }
    : { key: 'pending_sales', state: 'done', tier: 'good', label: 'Pending sales to bill: 0', detail: null };

  // Unmatched UPI credits
  const unmatched = await prisma.upiCredit.aggregate({
    where: { branchId, status: 'unmatched' },
    _count: true,
    _sum: { amount: true },
  });
  const upi: ActionableItem = unmatched._count
    ? {
        key: 'upi',
        state: 'pending',
        tier: 'attention',
        label: `Unmatched UPI credits: ${unmatched._count}`,
        detail: `₹${Number(unmatched._sum.amount ?? 0).toLocaleString('en-IN')} no bill explains`,
      }
    : { key: 'upi', state: 'done', tier: 'good', label: 'Unmatched UPI credits: 0', detail: null };

  return { items: [attendance, expenses, salary, pendingSales, upi] };
}

