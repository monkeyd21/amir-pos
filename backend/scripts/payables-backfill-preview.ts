/**
 * Payables backfill preview — READ ONLY. Writes nothing, ever.
 *
 * Decision D7's safety net. The daily EOD `totalExpenses` used to mean
 * "legacy expenses with status='approved', bucketed by expense.date".
 * After the payables migration it means "PayablePayment.amount, bucketed by
 * the IST day the money actually left, excluding voided payables".
 *
 * Those are two different numbers. Before the migration runs on prod the owner
 * should see exactly how history shifts, so this prints:
 *   1. legacy expenses: count + SUM(amount) per status
 *   2. per-day OLD vs NEW totals for the last 90 IST days — only the days that
 *      differ, with the delta (new − old)
 *   3. a one-line summary
 *
 * Run:
 *   cd backend && npx ts-node scripts/payables-backfill-preview.ts
 *   cd backend && npx ts-node scripts/payables-backfill-preview.ts --days 30
 *
 * The local dev database is stale and may not have the payables tables yet;
 * in that case this exits with a plain one-line message, not a stack trace.
 */
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { dateOnly, istToday, toIstYmd, ymdOf, Ymd } from '../src/utils/ist';

dotenv.config();

// Silence Prisma's own error banner — this script reports failures itself, in one line.
const prisma = new PrismaClient({ log: [] });

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const DAYS = (() => {
  const i = args.indexOf('--days');
  const n = i >= 0 ? parseInt(args[i + 1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 90;
})();

const money = (n: number): string =>
  `${n < 0 ? '-' : ''}₹${Math.abs(round2(n)).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The `Ymd` list for the last `days` IST calendar days, oldest first, ending today. */
function recentDays(days: number): Ymd[] {
  const todayMs = dateOnly(istToday()).getTime();
  const out: Ymd[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(ymdOf(new Date(todayMs - i * DAY_MS)));
  }
  return out;
}

/** UTC instant span covering one IST calendar day. */
function istDayWindow(ymd: Ymd): { start: Date; end: Date } {
  const start = new Date(dateOnly(ymd).getTime() - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * The human-readable core of a Prisma error: it wraps the real reason in an
 * "Invalid `prisma.x()` invocation" banner plus a source code-frame. Strip both
 * so the operator sees "The table … does not exist", not a stack trace.
 */
function reason(err: unknown): string[] {
  const raw = err instanceof Error ? err.message : String(err);
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^Invalid `prisma\./.test(l))
    .filter((l) => !/^(→|\d+\s|\/|in \/)/.test(l));
  return lines.slice(0, 2);
}

/** Fail loudly but readably when the local DB is behind the schema. */
function bail(what: string, err: unknown): never {
  console.error(`\nCannot ${what}.`);
  for (const line of reason(err)) console.error(`  ${line}`);
  console.error(
    '\nThis database is probably behind the payables migration. Point DATABASE_URL at a\n' +
      'migrated database (or run `npx prisma migrate deploy` there) and re-run. Nothing was written.'
  );
  process.exit(1);
}

async function legacyByStatus() {
  try {
    return await prisma.expense.groupBy({
      by: ['status'],
      _count: { _all: true },
      _sum: { amount: true },
    });
  } catch (e) {
    return bail('read the legacy expenses table', e);
  }
}

/** OLD rule: approved legacy expenses, bucketed by expense.date. */
async function oldDailyTotals(from: Ymd, to: Ymd): Promise<Map<Ymd, number>> {
  try {
    const rows = await prisma.expense.findMany({
      where: {
        status: 'approved',
        date: { gte: dateOnly(from), lt: new Date(dateOnly(to).getTime() + DAY_MS) },
      },
      select: { date: true, amount: true },
    });
    const map = new Map<Ymd, number>();
    for (const r of rows) {
      // Faithful reproduction of the OLD rule: it used `setHours(0,0,0,0)` day
      // bounds on a UTC server, i.e. it bucketed expense.date by its UTC day.
      // Bucketing it by IST here would invent a shift the old report never had.
      const key = ymdOf(new Date(r.date));
      map.set(key, round2((map.get(key) || 0) + Number(r.amount)));
    }
    return map;
  } catch (e) {
    return bail('read legacy expenses for the daily comparison', e);
  }
}

/** NEW rule: payable payments, bucketed by the IST day of paidAt, voids excluded. */
async function newDailyTotals(from: Ymd, to: Ymd): Promise<Map<Ymd, number>> {
  try {
    const rows = await prisma.payablePayment.findMany({
      where: {
        paidAt: { gte: istDayWindow(from).start, lt: istDayWindow(to).end },
        payable: { status: { not: 'void' } },
      },
      select: { paidAt: true, amount: true },
    });
    const map = new Map<Ymd, number>();
    for (const r of rows) {
      const key = toIstYmd(new Date(r.paidAt));
      map.set(key, round2((map.get(key) || 0) + Number(r.amount)));
    }
    return map;
  } catch (e) {
    return bail('read payable_payments (has the payables migration run here?)', e);
  }
}

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    return bail('connect to the database (check DATABASE_URL)', e);
  }

  const days = recentDays(DAYS);
  const from = days[0];
  const to = days[days.length - 1];

  console.log('\nPAYABLES BACKFILL PREVIEW — read only, nothing is written.');
  console.log(`Window: ${from} → ${to} (${DAYS} IST days)\n`);

  // ── 1. Legacy expenses by status ──
  const byStatus = await legacyByStatus();
  console.log('Legacy expenses by status');
  console.log('  status      count        amount');
  let legacyCount = 0;
  let legacyTotal = 0;
  for (const s of ['pending', 'approved', 'rejected']) {
    const row = byStatus.find((r) => String(r.status) === s);
    const count = row ? row._count._all : 0;
    const sum = row ? Number(row._sum.amount || 0) : 0;
    legacyCount += count;
    legacyTotal += sum;
    console.log(`  ${s.padEnd(10)}  ${String(count).padStart(5)}  ${money(sum).padStart(14)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)}  ${String(legacyCount).padStart(5)}  ${money(legacyTotal).padStart(14)}`);
  console.log(
    `  (only 'approved' — ${money(
      Number(byStatus.find((r) => String(r.status) === 'approved')?._sum.amount || 0)
    )} — ever reached the old daily total)\n`
  );

  // ── 2. Day-by-day OLD vs NEW ──
  const [oldMap, newMap] = await Promise.all([oldDailyTotals(from, to), newDailyTotals(from, to)]);

  const diffs = days
    .map((d) => ({ day: d, old: oldMap.get(d) || 0, next: newMap.get(d) || 0 }))
    .map((r) => ({ ...r, delta: round2(r.next - r.old) }))
    .filter((r) => r.delta !== 0);

  console.log(`Days where the daily totalExpenses changes (${diffs.length} of ${DAYS})`);
  if (diffs.length === 0) {
    console.log('  none — the two rules agree across the whole window.\n');
  } else {
    console.log('  date              OLD (approved)      NEW (paid)         DELTA');
    for (const r of diffs) {
      console.log(
        `  ${r.day}  ${money(r.old).padStart(16)}  ${money(r.next).padStart(16)}  ${money(r.delta).padStart(14)}`
      );
    }
    console.log('');
  }

  // ── 3. One-line summary ──
  const largest = diffs.reduce(
    (best, r) => (Math.abs(r.delta) > Math.abs(best?.delta ?? 0) ? r : best),
    diffs[0]
  );
  console.log(
    diffs.length === 0
      ? '0 days differ.'
      : `${diffs.length} days differ, largest delta ${money(largest.delta)} on ${largest.day}`
  );
  console.log('');
}

main()
  .catch((e) => {
    console.error('\nPreview failed.');
    for (const line of reason(e)) console.error(`  ${line}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
