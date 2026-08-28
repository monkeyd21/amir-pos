/**
 * Asia/Kolkata calendar helpers.
 *
 * The server runs UTC. Every payroll, attendance and payables period in this
 * system is an IST calendar date — a day marked at 23:30 IST belongs to that
 * IST day, not to the UTC day it happens to fall in. Nothing here may use the
 * host's local timezone; `new Date().getDate()` is always wrong for this.
 *
 * Convention for Prisma `@db.Date` columns: the value is a date, not an
 * instant, so it is stored as UTC midnight of that calendar day (`dateOnly`).
 * That matches how sales.businessDate is written elsewhere in the codebase.
 */

/** IST is a fixed +05:30 offset — no daylight saving, so arithmetic is safe. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `YYYY-MM-DD` (an IST calendar date) */
export type Ymd = string;
/** `YYYY-MM` (an IST calendar month) */
export type Ym = string;

const pad = (n: number): string => String(n).padStart(2, '0');

/** The IST calendar date an instant falls on. */
export const toIstYmd = (instant: Date = new Date()): Ymd => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

/** The IST calendar month an instant falls in. */
export const toIstMonth = (instant: Date = new Date()): Ym => toIstYmd(instant).slice(0, 7);

/** Today, in IST. */
export const istToday = (): Ymd => toIstYmd(new Date());

/** The month containing today, in IST. */
export const istThisMonth = (): Ym => toIstMonth(new Date());

/**
 * UTC midnight of an IST calendar date — the value to write to a `@db.Date`
 * column, and to compare such columns against.
 */
export const dateOnly = (ymd: Ymd): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Read a `@db.Date` column back as its calendar date. */
export const ymdOf = (date: Date): Ymd =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** True for a well-formed `YYYY-MM`. */
export const isMonth = (value: string): value is Ym => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** True for a well-formed `YYYY-MM-DD`. */
export const isYmd = (value: string): value is Ymd => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The month a date belongs to. */
export const monthOf = (ymd: Ymd): Ym => ymd.slice(0, 7);

/** Number of days in an IST calendar month. */
export const daysInMonth = (month: Ym): number => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Every calendar date in a month, in order. */
export const monthDays = (month: Ym): Ymd[] => {
  const total = daysInMonth(month);
  const out: Ymd[] = [];
  for (let d = 1; d <= total; d += 1) out.push(`${month}-${pad(d)}`);
  return out;
};

/**
 * Half-open `@db.Date` bounds for a month: `{ gte: start, lt: end }`.
 * Half-open, so the last day of the month is included without a time
 * component creeping in.
 */
export const monthBounds = (month: Ym): { start: Date; end: Date } => {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

/** Day of week for a calendar date: 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = (ymd: Ymd): number => dateOnly(ymd).getUTCDay();

/** Clamp a day-of-month (e.g. a category's dueDay of 31) into a real month. */
export const dueDateFor = (month: Ym, dueDay: number): Ymd =>
  `${month}-${pad(Math.min(Math.max(dueDay, 1), daysInMonth(month)))}`;

/** `2026-08` → `Aug 2026`, for payable titles and screen labels. */
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (month: Ym): string => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
};
