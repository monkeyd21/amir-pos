/**
 * IST calendar helpers for the attendance grid + payroll screens.
 *
 * The server runs UTC and every payroll date is an Asia/Kolkata calendar date,
 * so NEVER use local-time getters (getDate/setHours) to derive a day here.
 * Mirrors backend/src/utils/ist.ts.
 */

const IST_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Today as an IST "YYYY-MM-DD". */
export function istToday(): string {
  return IST_YMD.format(new Date());
}

/** Current IST month as "YYYY-MM". */
export function istThisMonth(): string {
  return istToday().slice(0, 7);
}

/**
 * Normalise anything the API hands back into a bare "YYYY-MM-DD".
 * Prisma @db.Date columns serialise as "2026-08-05T00:00:00.000Z"; the date
 * part is already the intended IST calendar day, so slice rather than re-parse.
 */
export function ymd(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every "YYYY-MM-DD" in the month, in order. */
export function monthDays(month: string): string[] {
  const n = daysInMonth(month);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
  return out;
}

/** 0 = Sunday … 6 = Saturday, computed UTC-safe from the bare date string. */
export function dayOfWeek(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function dayNumber(day: string): number {
  return Number(day.slice(8, 10));
}

export function weekdayShort(day: string): string {
  return WEEKDAY_SHORT[dayOfWeek(day)];
}

export function weekdayInitial(day: string): string {
  return WEEKDAY_INITIAL[dayOfWeek(day)];
}

/** "2026-08" -> "August 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-08-05" -> "Wed 05 Aug". */
export function dayLabel(day: string): string {
  if (!day) return '';
  return `${weekdayShort(day)} ${day.slice(8, 10)} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1].slice(0, 3)}`;
}

/** Shift a "YYYY-MM" by n months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** ₹ with thousands separators. Decimals arrive as strings — Number() first. */
export function money(value: unknown): string {
  const n = Number(value ?? 0);
  return `₹${(isNaN(n) ? 0 : n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
