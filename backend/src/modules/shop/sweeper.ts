/**
 * Housekeeping for lapsed reservations.
 *
 * Purely cosmetic: every availability read already filters on
 * `expiresAt > now`, so stock is freed the instant a hold lapses whether or not
 * this ever runs. It exists so the reservations table reads truthfully in
 * reports and does not accumulate an unbounded tail of stale `held` rows.
 *
 * Deliberately an in-process interval rather than a cron job — the box runs one
 * Node process and correctness does not depend on this firing.
 */
import { shopConfig } from '../../config/shop';
import { expireStaleHolds } from './availability';

let timer: NodeJS.Timeout | null = null;

export function startReservationSweeper(): void {
  if (timer) return;

  const run = async () => {
    try {
      const count = await expireStaleHolds();
      if (count > 0) {
        console.log(`[shop/sweeper] expired ${count} lapsed reservation(s)`);
      }
    } catch (err: any) {
      console.warn(`[shop/sweeper] ${err.message}`);
    }
  };

  timer = setInterval(run, shopConfig.reservation.sweeperIntervalMs);
  // Never hold the process open on this alone.
  timer.unref?.();
  void run();
}

export function stopReservationSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
