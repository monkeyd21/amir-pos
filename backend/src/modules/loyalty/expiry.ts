import prisma from '../../config/database';

/**
 * Loyalty points expiry (dashboard spec §8 alert #3, §9 loyalty nudge).
 *
 * Off unless the shop sets `LoyaltyConfig.pointsExpiryMonths`; points never
 * expired before this, and a shop that never turns it on sees no change.
 *
 * Each earned batch carries its own `expiresAt`. Spending is counted against
 * the OLDEST points first, so the points that lapse are never more than what
 * the customer still holds: on any date T,
 *
 *   due by T = (points earned that expire by T) − (every point ever taken out)
 *
 * "Taken out" is every negative entry: redeemed, reversed on a return,
 * already expired, or adjusted down. Points that never expire (a restored
 * redemption, an adjustment up) are not counted as expiring, so spending
 * always eats the expiring batches first. That is the reading most generous
 * to the customer, deliberately.
 */

export function pointsExpiryDate(months: number | null | undefined, earnedAt = new Date()): Date | null {
  if (!months || months <= 0) return null;
  const d = new Date(earnedAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export async function currentExpiryMonths(): Promise<number | null> {
  const cfg = await prisma.loyaltyConfig.findFirst({ select: { pointsExpiryMonths: true } });
  return cfg?.pointsExpiryMonths ?? null;
}

/**
 * Write off points whose time has come. Idempotent: running it twice in a row
 * finds nothing the second time, because the first run's write-offs count as
 * points taken out.
 */
export async function expireDuePoints(now = new Date()): Promise<{ customers: number; points: number }> {
  const due = await prisma.$queryRaw<{ id: number; due: bigint; balance: number }[]>`
    SELECT c.id, c."loyaltyPoints" AS balance,
           (COALESCE(SUM(t.points) FILTER (WHERE t.type = 'earned' AND t."expiresAt" <= ${now}), 0)
            + COALESCE(SUM(t.points) FILTER (WHERE t.points < 0), 0)) AS due
    FROM customers c
    JOIN loyalty_transactions t ON t."customerId" = c.id
    WHERE c.id IN (SELECT DISTINCT "customerId" FROM loyalty_transactions WHERE type = 'earned' AND "expiresAt" <= ${now})
    GROUP BY c.id, c."loyaltyPoints"
    HAVING (COALESCE(SUM(t.points) FILTER (WHERE t.type = 'earned' AND t."expiresAt" <= ${now}), 0)
            + COALESCE(SUM(t.points) FILTER (WHERE t.points < 0), 0)) > 0`;

  let customers = 0;
  let points = 0;
  for (const row of due) {
    const amount = Math.min(Number(row.due), Math.max(0, row.balance));
    if (amount <= 0) continue;
    await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: a sale may have just spent some.
      const c = await tx.customer.findUnique({ where: { id: row.id }, select: { loyaltyPoints: true } });
      const take = Math.min(amount, Math.max(0, c?.loyaltyPoints ?? 0));
      if (take <= 0) return;
      await tx.loyaltyTransaction.create({
        data: { customerId: row.id, points: -take, type: 'expired', description: `${take} points expired` },
      });
      await tx.customer.update({ where: { id: row.id }, data: { loyaltyPoints: { decrement: take } } });
      customers += 1;
      points += take;
    });
  }
  return { customers, points };
}

export interface ExpiringCustomer {
  id: number;
  name: string;
  phone: string;
  balance: number;
  expiring: number;
  /** The earliest date in the window on which some of them lapse. */
  expiresOn: string;
}

/** Customers with points lapsing within `days` (and not already lapsed). */
export async function expiringSoon(days: number, now = new Date()): Promise<ExpiringCustomer[]> {
  const until = new Date(now.getTime() + days * 24 * 3600_000);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT c.id, c."firstName" AS first, c."lastName" AS last, c.phone, c."loyaltyPoints" AS balance,
           (COALESCE(SUM(t.points) FILTER (WHERE t.type = 'earned' AND t."expiresAt" <= ${until}), 0)
            + COALESCE(SUM(t.points) FILTER (WHERE t.points < 0), 0)) AS expiring,
           MIN(t."expiresAt") FILTER (WHERE t.type = 'earned' AND t."expiresAt" > ${now} AND t."expiresAt" <= ${until}) AS first_expiry
    FROM customers c
    JOIN loyalty_transactions t ON t."customerId" = c.id
    WHERE c."loyaltyPoints" > 0
      AND c.id IN (SELECT DISTINCT "customerId" FROM loyalty_transactions
                   WHERE type = 'earned' AND "expiresAt" > ${now} AND "expiresAt" <= ${until})
    GROUP BY c.id, c."firstName", c."lastName", c.phone, c."loyaltyPoints"`;
  return rows
    .map((r) => ({
      id: Number(r.id),
      name: `${r.first} ${r.last ?? ''}`.trim(),
      phone: r.phone,
      balance: Number(r.balance),
      expiring: Math.min(Number(r.expiring), Number(r.balance)),
      expiresOn: r.first_expiry ? new Date(r.first_expiry).toISOString() : '',
    }))
    .filter((r) => r.expiring > 0 && r.expiresOn)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || b.expiring - a.expiring);
}

let timer: NodeJS.Timeout | null = null;

/** Hourly, in-process, like the reservation sweeper. Harmless if it never runs: balances just stay higher until it does. */
export function startLoyaltyExpirySweeper(): void {
  if (timer) return;
  const run = async () => {
    try {
      const r = await expireDuePoints();
      if (r.points > 0) console.log(`[loyalty] expired ${r.points} points across ${r.customers} customer(s)`);
    } catch (err: any) {
      console.warn(`[loyalty] expiry sweep failed: ${err.message}`);
    }
  };
  timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
  void run();
}

export function stopLoyaltyExpirySweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
