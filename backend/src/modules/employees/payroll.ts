/**
 * Payroll calculation engine (spec §3.4).
 *
 * PURE module — no Prisma, no I/O, no clock beyond an injectable `today`.
 * Everything here is unit-tested directly in `__tests__/payroll.test.ts`;
 * the service layer only feeds it rows it has already fetched.
 *
 * The two formulas, verbatim from the spec:
 *
 *   fixed_monthly: net = monthlySalary
 *                        - (absentDays * perDayRate)
 *                        - (halfDays * 0.5 * perDayRate)
 *                        - manualDeductionTotal
 *
 *   daily_wage:    net = (presentDays + lateDays + halfDays * 0.5 + paidOffDays)
 *                        * perDayRate
 *                        - manualDeductionTotal
 *
 * Binding decisions:
 *   D2  Unmarked days: fixed_monthly deducts NOTHING, daily_wage pays NOTHING.
 *       They are counted and surfaced so the owner can see "N days unmarked".
 *   D5  A `late` day is a FULL PAID day in BOTH formulas. It is reported as
 *       lateDays for the record only — never auto-deducted.
 *   D8  Net clamps at 0. Any excess deduction that could not be recovered is
 *       reported as `unrecoveredExcess` and NEVER carried into another month.
 *   D9  Days before User.joiningDate count as ABSENT for a fixed_monthly month
 *       (the base salary assumes a whole month), and are simply not counted for
 *       daily_wage (an unworked day earns nothing there anyway).
 */

import { Ym, Ymd, dayOfWeek, istToday, monthDays } from '../../utils/ist';

export type SalaryTypeValue = 'fixed_monthly' | 'daily_wage';

export type AttendanceStatusValue =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'late'
  | 'paid_weekly_off';

export const ATTENDANCE_STATUSES: AttendanceStatusValue[] = [
  'present',
  'absent',
  'half_day',
  'late',
  'paid_weekly_off',
];

export const SALARY_TYPES: SalaryTypeValue[] = ['fixed_monthly', 'daily_wage'];

/** Day counts for one employee-month. */
export interface DayCounts {
  presentDays: number;
  absentDays: number;
  halfDays: number;
  lateDays: number;
  paidOffDays: number;
  /** Elapsed days in the month with no attendance row (D2). */
  unmarkedDays: number;
}

export const emptyCounts = (): DayCounts => ({
  presentDays: 0,
  absentDays: 0,
  halfDays: 0,
  lateDays: 0,
  paidOffDays: 0,
  unmarkedDays: 0,
});

/** One attendance row, reduced to what the engine needs. */
export interface AttendanceMark {
  date: Ymd;
  status: AttendanceStatusValue;
  manualDeduction?: number | string | null;
}

export interface CountAttendanceInput {
  month: Ym;
  /** Drives D9: pre-joining days are absent for fixed_monthly, skipped for daily_wage. */
  salaryType?: SalaryTypeValue | null;
  marks: AttendanceMark[];
  /** `YYYY-MM-DD`, or null when the employee has no recorded joining date. */
  joiningDate?: Ymd | null;
  /** IST today; injectable so tests never depend on the wall clock. */
  today?: Ymd;
}

export interface CountAttendanceResult {
  counts: DayCounts;
  /** Sum of every manualDeduction on the month's rows. */
  manualDeductionTotal: number;
  /** Days in the month that fall before joiningDate (D9). */
  preJoiningDays: number;
  /** Days in the month that have not happened yet — never "unmarked" (D2). */
  futureDays: number;
  /** Days with an attendance row. */
  markedDays: number;
  /** Every day of the month, in order. */
  days: Ymd[];
}

/** Money rounded to paise, immune to float dust (0.1 + 0.2 style). */
export const round2 = (n: number): number =>
  Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/** Prisma Decimal arrives over JSON as a STRING — always coerce before math. */
export const num = (v: unknown): number => {
  const n = Number((v ?? 0) as any);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Turn a month's attendance rows into day counts.
 *
 * Iterates the calendar month rather than the rows, so absent-by-omission and
 * unmarked-vs-future are decided by the calendar, not by what happens to exist
 * in the table.
 */
export function countAttendance(input: CountAttendanceInput): CountAttendanceResult {
  const days = monthDays(input.month);
  const today = input.today ?? istToday();
  const joining = input.joiningDate ?? null;
  const isFixed = input.salaryType === 'fixed_monthly';

  const byDate = new Map<Ymd, AttendanceMark>();
  for (const m of input.marks) byDate.set(m.date, m);

  const counts = emptyCounts();
  let manualDeductionTotal = 0;
  let preJoiningDays = 0;
  let futureDays = 0;
  let markedDays = 0;

  for (const day of days) {
    const mark = byDate.get(day);
    if (mark) {
      markedDays += 1;
      manualDeductionTotal += num(mark.manualDeduction);
    }

    // D9 — before the employee joined. Not markable in the UI; if a stray row
    // exists it still contributes its manual deduction (above) but its status
    // is ignored: the day is absent (fixed) or simply outside the month (daily).
    if (joining && day < joining) {
      preJoiningDays += 1;
      if (isFixed) counts.absentDays += 1;
      continue;
    }

    if (mark) {
      switch (mark.status) {
        case 'present':
          counts.presentDays += 1;
          break;
        case 'absent':
          counts.absentDays += 1;
          break;
        case 'half_day':
          counts.halfDays += 1;
          break;
        case 'late':
          // D5 — a full paid day, recorded separately for the record only.
          counts.lateDays += 1;
          break;
        case 'paid_weekly_off':
          counts.paidOffDays += 1;
          break;
      }
      continue;
    }

    // D2 — only ELAPSED days count as unmarked; the rest of the month is not a
    // warning, it simply has not happened yet.
    if (day > today) futureDays += 1;
    else counts.unmarkedDays += 1;
  }

  return {
    counts,
    manualDeductionTotal: round2(manualDeductionTotal),
    preJoiningDays,
    futureDays,
    markedDays,
    days,
  };
}

export interface ComputeSalaryInput {
  salaryType: SalaryTypeValue;
  /** fixed_monthly only; ignored for daily_wage. */
  monthlySalary?: number | string | null;
  perDayRate?: number | string | null;
  counts: DayCounts;
  manualDeductionTotal?: number | string | null;
}

export interface SalaryBreakdown {
  salaryType: SalaryTypeValue;
  /** Snapshot inputs, echoed back so callers can persist them (D10). */
  baseAmount: number;
  perDayRate: number;
  /** daily_wage: present + late + half*0.5 + paidOff. fixed_monthly: 0. */
  earnedDays: number;
  /** Gross before manual deductions (base − attendance loss, or days × rate). */
  grossAmount: number;
  attendanceDeduction: number;
  manualDeductionTotal: number;
  /** Clamped at 0 (D8). */
  netAmount: number;
  /** How far below 0 the raw figure went. Reported, never carried forward (D8). */
  unrecoveredExcess: number;
}

/**
 * The month's money, from day counts + the employee's rate config.
 *
 * Worked examples that must hold (see the tests):
 *   fixed 18000 @700/day, 2 absent + 1 half + 100 manual  → 16150
 *   fixed 15000 @580/day, clean month                     → 15000
 *   daily @600/day, 24 present + 2 half + 4 paid-off      → 17400
 */
export function computeSalary(input: ComputeSalaryInput): SalaryBreakdown {
  const perDayRate = num(input.perDayRate);
  const manualDeductionTotal = round2(num(input.manualDeductionTotal));
  const c = input.counts;

  let baseAmount = 0;
  let earnedDays = 0;
  let attendanceDeduction = 0;
  let grossAmount = 0;

  if (input.salaryType === 'fixed_monthly') {
    baseAmount = round2(num(input.monthlySalary));
    // late = full paid day (D5); unmarked deducts nothing (D2).
    attendanceDeduction = round2(
      c.absentDays * perDayRate + c.halfDays * 0.5 * perDayRate
    );
    grossAmount = round2(baseAmount - attendanceDeduction);
  } else {
    // daily_wage — you are paid for the days you were there. late counts as a
    // full day (D5), a half day as half, a paid weekly off as a full day.
    // Unmarked days pay nothing (D2), which needs no explicit handling.
    earnedDays =
      c.presentDays + c.lateDays + c.halfDays * 0.5 + c.paidOffDays;
    grossAmount = round2(earnedDays * perDayRate);
  }

  const raw = round2(grossAmount - manualDeductionTotal);
  // D8 — clamp at 0 and name the shortfall; never carry it into next month.
  const netAmount = raw > 0 ? raw : 0;
  const unrecoveredExcess = raw < 0 ? round2(-raw) : 0;

  return {
    salaryType: input.salaryType,
    baseAmount,
    perDayRate,
    earnedDays,
    grossAmount,
    attendanceDeduction,
    manualDeductionTotal,
    netAmount,
    unrecoveredExcess,
  };
}

export interface EmployeePayrollConfig {
  salaryType?: SalaryTypeValue | null;
  monthlySalary?: number | string | null;
  perDayRate?: number | string | null;
  joiningDate?: Ymd | null;
  weeklyOffDay?: number | null;
}

export interface MonthPayrollResult extends CountAttendanceResult {
  breakdown: SalaryBreakdown;
}

/**
 * Convenience wrapper: count the month, then price it. Returns a zeroed
 * breakdown (typed fixed_monthly) when the employee has no salary type set —
 * an unconfigured employee shows up in the list with ₹0 and a `configured:false`
 * flag rather than blowing up the whole month.
 */
export function computeMonth(
  month: Ym,
  config: EmployeePayrollConfig,
  marks: AttendanceMark[],
  today?: Ymd
): MonthPayrollResult {
  const counted = countAttendance({
    month,
    salaryType: config.salaryType ?? null,
    marks,
    joiningDate: config.joiningDate ?? null,
    today,
  });

  const breakdown = computeSalary({
    salaryType: (config.salaryType ?? 'fixed_monthly') as SalaryTypeValue,
    monthlySalary: config.salaryType ? config.monthlySalary : 0,
    perDayRate: config.salaryType ? config.perDayRate : 0,
    counts: counted.counts,
    manualDeductionTotal: counted.manualDeductionTotal,
  });

  return { ...counted, breakdown };
}

/** True when the employee has enough config to be finalised for a month. */
export function isPayrollConfigured(config: EmployeePayrollConfig): boolean {
  if (config.salaryType !== 'fixed_monthly' && config.salaryType !== 'daily_wage') {
    return false;
  }
  if (num(config.perDayRate) <= 0) return false;
  if (config.salaryType === 'fixed_monthly' && num(config.monthlySalary) <= 0) return false;
  return true;
}

/**
 * Shops swap the weekly off around, so a paid_weekly_off on a different weekday
 * is ALLOWED — blocking it would just get worked around. The response flags it
 * so the owner sees what they did.
 */
export function weeklyOffMismatch(
  date: Ymd,
  status: AttendanceStatusValue,
  weeklyOffDay?: number | null
): boolean {
  if (status !== 'paid_weekly_off') return false;
  if (weeklyOffDay === null || weeklyOffDay === undefined) return false;
  return dayOfWeek(date) !== weeklyOffDay;
}
