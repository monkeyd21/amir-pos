import { DashboardPeriod } from '@clothing-erp/shared';
import { AppError } from '../../middleware/errorHandler';

/**
 * Dashboard spec §1.5: what each period tab covers, what it is compared with,
 * and what "last year" means for it. Pure: every input is an ISO day
 * (`YYYY-MM-DD`, a trading day), so this is tested without a database.
 *
 * | Tab    | Range                 | Previous                              | Last year                  |
 * |--------|-----------------------|---------------------------------------|----------------------------|
 * | Today  | the trading day       | the previous trading day              | same calendar date         |
 * | Week   | Monday → today        | last Monday → same weekday            | the same weekdays, 52 wks back |
 * | Month  | 1st → today           | last month 1st → same date (clamped)  | same dates last year       |
 * | Custom | chosen from → to      | the equal-length run just before it   | none (spec: not shown)     |
 *
 * "Previous trading day" is the last day the shop actually traded, not the
 * calendar yesterday: comparing a Monday with the Sunday the shop was shut
 * would say "no data" when the owner means "vs last time we were open".
 * The week's last-year range steps back 364 days so Saturday lines up with a
 * Saturday; a whole-week comparison across different weekdays is noise.
 */

export interface DayRange {
  from: string;
  to: string;
}

export interface ResolvedPeriod {
  period: DashboardPeriod;
  current: DayRange;
  previous: DayRange;
  lastYear: DayRange | null;
  /** Number of trading days the range spans (inclusive). */
  days: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  return toYmd(new Date(toDate(ymd).getTime() + n * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** The same calendar date a year earlier; 29 Feb falls back to 28 Feb. */
export function sameDateLastYear(ymd: string): string {
  const d = toDate(ymd);
  const y = d.getUTCFullYear() - 1;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toYmd(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

/** Monday of the week `ymd` falls in. */
export function mondayOf(ymd: string): string {
  const dow = toDate(ymd).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

export function resolvePeriod(input: {
  period: DashboardPeriod;
  /** The trading day the dashboard calls "Today". */
  businessDate: string;
  /** The last earlier day the shop traded, if any. */
  previousTradingDay: string | null;
  from?: string;
  to?: string;
}): ResolvedPeriod {
  const bd = input.businessDate;

  switch (input.period) {
    case 'today': {
      const prev = input.previousTradingDay ?? addDays(bd, -1);
      const ly = sameDateLastYear(bd);
      return {
        period: 'today',
        current: { from: bd, to: bd },
        previous: { from: prev, to: prev },
        lastYear: { from: ly, to: ly },
        days: 1,
      };
    }

    case 'week': {
      const from = mondayOf(bd);
      return {
        period: 'week',
        current: { from, to: bd },
        previous: { from: addDays(from, -7), to: addDays(bd, -7) },
        lastYear: { from: addDays(from, -364), to: addDays(bd, -364) },
        days: daysBetween(from, bd) + 1,
      };
    }

    case 'month': {
      const from = `${bd.slice(0, 7)}-01`;
      const d = toDate(bd);
      const prevMonthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
      const prevMonthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
      const prevTo = new Date(
        Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), Math.min(d.getUTCDate(), prevMonthEnd.getUTCDate()))
      );
      return {
        period: 'month',
        current: { from, to: bd },
        previous: { from: toYmd(prevMonthStart), to: toYmd(prevTo) },
        lastYear: { from: sameDateLastYear(from), to: sameDateLastYear(bd) },
        days: daysBetween(from, bd) + 1,
      };
    }

    case 'custom': {
      const { from, to } = input;
      if (!from || !to || !YMD.test(from) || !YMD.test(to)) {
        throw new AppError('A custom period needs a from and to date', 400);
      }
      if (from > to) throw new AppError('The custom period ends before it starts', 400);
      if (to > bd) throw new AppError('The custom period cannot run past today', 400);
      const span = daysBetween(from, to) + 1;
      if (span > 366) throw new AppError('A custom period can cover at most a year; use Reports for longer', 400);
      return {
        period: 'custom',
        current: { from, to },
        previous: { from: addDays(from, -span), to: addDays(from, -1) },
        lastYear: null,
        days: span,
      };
    }

    default:
      throw new AppError(`Unknown period "${input.period}"`, 400);
  }
}
