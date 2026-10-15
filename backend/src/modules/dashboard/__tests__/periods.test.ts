import { mondayOf, resolvePeriod, sameDateLastYear } from '../periods';

const bd = '2026-10-15'; // a Thursday

describe('resolvePeriod (§1.5)', () => {
  it('compares Today with the last day the shop traded', () => {
    const r = resolvePeriod({ period: 'today', businessDate: bd, previousTradingDay: '2026-10-13' });
    expect(r.current).toEqual({ from: bd, to: bd });
    expect(r.previous).toEqual({ from: '2026-10-13', to: '2026-10-13' });
    expect(r.lastYear).toEqual({ from: '2025-10-15', to: '2025-10-15' });
  });

  it('falls back to the calendar yesterday when there is no earlier trading day', () => {
    const r = resolvePeriod({ period: 'today', businessDate: bd, previousTradingDay: null });
    expect(r.previous.from).toBe('2026-10-14');
  });

  it('runs the week from Monday and lines last year up by weekday', () => {
    const r = resolvePeriod({ period: 'week', businessDate: bd, previousTradingDay: null });
    expect(r.current).toEqual({ from: '2026-10-12', to: bd });
    expect(r.previous).toEqual({ from: '2026-10-05', to: '2026-10-08' });
    // 364 days back: still Monday to Thursday.
    expect(r.lastYear).toEqual({ from: '2025-10-13', to: '2025-10-16' });
    expect(r.days).toBe(4);
  });

  it('clamps the month comparison to the end of a shorter month', () => {
    const r = resolvePeriod({ period: 'month', businessDate: '2026-03-31', previousTradingDay: null });
    expect(r.current).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(r.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(r.lastYear).toEqual({ from: '2025-03-01', to: '2025-03-31' });
  });

  it('compares a custom range with the same length just before it, and has no YoY', () => {
    const r = resolvePeriod({ period: 'custom', businessDate: bd, previousTradingDay: null, from: '2026-10-01', to: '2026-10-10' });
    expect(r.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' });
    expect(r.lastYear).toBeNull();
    expect(r.days).toBe(10);
  });

  it('refuses a custom range that is backwards, in the future or too long', () => {
    const base = { period: 'custom' as const, businessDate: bd, previousTradingDay: null };
    expect(() => resolvePeriod({ ...base, from: '2026-10-10', to: '2026-10-01' })).toThrow(/ends before/);
    expect(() => resolvePeriod({ ...base, from: '2026-10-10', to: '2026-10-20' })).toThrow(/past today/);
    expect(() => resolvePeriod({ ...base, from: '2024-01-01', to: '2026-10-01' })).toThrow(/at most a year/);
    expect(() => resolvePeriod({ ...base })).toThrow(/from and to/);
  });
});

describe('date helpers', () => {
  it('maps 29 Feb to 28 Feb a year back', () => {
    expect(sameDateLastYear('2028-02-29')).toBe('2027-02-28');
  });

  it('finds Monday, including from a Sunday', () => {
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
  });
});
