import { Prisma, PrismaClient } from '@prisma/client';
import { dateOnly, toIstYmd } from './ist';

/**
 * The trading day (§11.0 / dashboard spec §12.0). A sale, return or anything
 * else that rolls up "by day" belongs to the day of the shift it happened in,
 * not to the wall clock: a bill rung at 01:30 during a shift opened the evening
 * before still belongs to the evening before.
 *
 * Values are Prisma `@db.Date` style: UTC midnight of the India calendar day.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Past this IST hour an unclosed shift from an earlier day blocks billing. */
export const SHIFT_CUTOFF_HOUR = 4;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The India calendar day of `instant`, as UTC midnight of that day. */
export function istBusinessDate(instant: Date): Date {
  return dateOnly(toIstYmd(instant));
}

/** The IST hour of day (0 to 23). */
export function istHour(instant: Date): number {
  return new Date(instant.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** A shift's trading day: frozen at open, else derived from when it opened. */
export function businessDateOf(session: { businessDate: Date | null; openedAt: Date }): Date {
  if (session.businessDate) {
    const d = session.businessDate;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return istBusinessDate(session.openedAt);
}

/**
 * The trading day for something `userId` is doing right now: their open
 * shift's day, else today in India. Used by writes that are not themselves a
 * checkout (a refund at the Sales screen, a pending sale) so they land on the
 * same day as the bills around them.
 */
export async function businessDateForUser(db: Db, userId: number, now = new Date()): Promise<Date> {
  const session = await db.posSession.findFirst({
    where: { userId, status: 'open' },
    select: { businessDate: true, openedAt: true },
    orderBy: { openedAt: 'desc' },
  });
  return session ? businessDateOf(session) : istBusinessDate(now);
}

/**
 * The trading day the dashboard calls "Today" for a branch.
 *
 * - A shift is open: its day (the earliest open one, if two tills are open).
 * - No shift is open: today in India, except in the small hours before the
 *   cutoff, which still belong to yesterday. So the owner who closed at 23:45
 *   and checks the dashboard at 00:30 sees the day they just closed, with its
 *   cash-in-drawer summary, not an empty new day.
 */
export async function currentBusinessDateForBranch(db: Db, branchId: number, now = new Date()): Promise<Date> {
  const open = await db.posSession.findFirst({
    where: { branchId, status: 'open' },
    select: { businessDate: true, openedAt: true },
    orderBy: { openedAt: 'asc' },
  });
  if (open) return businessDateOf(open);
  const today = istBusinessDate(now);
  if (istHour(now) < SHIFT_CUTOFF_HOUR) {
    return new Date(today.getTime() - 24 * 60 * 60 * 1000);
  }
  return today;
}
