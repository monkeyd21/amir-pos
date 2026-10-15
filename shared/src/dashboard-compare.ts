/**
 * Dashboard spec §2.2: how a number is compared with an earlier one, for both
 * "vs previous period" and YoY.
 *
 *   change % = (this − that) / that × 100
 *
 * - No earlier figure, or an earlier figure of zero: there is nothing honest to
 *   divide by, so the comparison says so (`noData`) instead of printing ∞.
 * - Within ±2% is "flat", shown grey: noise, not news.
 * - `higherIsBetter` decides the colour, not the arrow. More discount given is
 *   an arrow up and still a bad sign.
 */

export type CompareDirection = 'up' | 'down' | 'flat';

export interface Comparison {
  /** Percentage change, rounded to one place. Null when there is no baseline. */
  pct: number | null;
  /** Absolute change in the metric's own unit (₹, bills, points of margin). */
  delta: number | null;
  direction: CompareDirection | null;
  /** True when the change is good news for the shop. Null when flat or no data. */
  good: boolean | null;
  noData: boolean;
}

export const FLAT_BAND_PCT = 2;

export function compare(
  current: number | null | undefined,
  previous: number | null | undefined,
  opts: { higherIsBetter?: boolean } = {}
): Comparison {
  const higherIsBetter = opts.higherIsBetter ?? true;
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return { pct: null, delta: null, direction: null, good: null, noData: true };
  }
  const delta = Math.round((current - previous) * 100) / 100;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  if (Math.abs(pct) <= FLAT_BAND_PCT) {
    return { pct, delta, direction: 'flat', good: null, noData: false };
  }
  const direction: CompareDirection = delta > 0 ? 'up' : 'down';
  return { pct, delta, direction, good: (delta > 0) === higherIsBetter, noData: false };
}

/**
 * A rate (margin %, returning-customer %) compared in percentage POINTS, which
 * is how a margin move is read: 38% → 40% is "+2 pts", not "+5.3%". The flat
 * band is half a point.
 */
export function comparePoints(
  current: number | null | undefined,
  previous: number | null | undefined,
  opts: { higherIsBetter?: boolean } = {}
): Comparison {
  const higherIsBetter = opts.higherIsBetter ?? true;
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { pct: null, delta: null, direction: null, good: null, noData: true };
  }
  const delta = Math.round((current - previous) * 10) / 10;
  if (Math.abs(delta) <= 0.5) return { pct: null, delta, direction: 'flat', good: null, noData: false };
  const direction: CompareDirection = delta > 0 ? 'up' : 'down';
  return { pct: null, delta, direction, good: (delta > 0) === higherIsBetter, noData: false };
}
