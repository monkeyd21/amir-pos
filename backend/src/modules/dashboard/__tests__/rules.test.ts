import { HourCell, eodTier } from '../activity';
import { DashboardAlert, noSalePeakAlerts, prioritiseAlerts, returnRateAlerts } from '../alerts';
import { candidateInsights, chooseInsight, InsightInputs } from '../insights';
import { coverageLevel } from '../service';

const alert = (key: string, severity: DashboardAlert['severity']): DashboardAlert => ({
  key,
  type: 'held_bill',
  severity,
  title: key,
  detail: '',
  subject: null,
});

describe('prioritiseAlerts (§8.1)', () => {
  it('orders red, amber, blue, purple and keeps five', () => {
    const out = prioritiseAlerts(
      [alert('p', 'purple'), alert('b', 'blue'), alert('r', 'red'), alert('a1', 'amber'), alert('a2', 'amber'), alert('r2', 'red')],
      new Set()
    );
    expect(out.map((a) => a.key)).toEqual(['r', 'r2', 'a1', 'a2', 'b']);
  });

  it('leaves out dismissed occurrences', () => {
    expect(prioritiseAlerts([alert('x', 'red'), alert('y', 'blue')], new Set(['x'])).map((a) => a.key)).toEqual(['y']);
  });
});

describe('no sale in a peak hour (alert #4)', () => {
  // Thursdays: 18:00 and 19:00 are the peaks, 6 Thursdays on record.
  const history: HourCell[] = [
    { dow: 4, hour: 12, bills: 12, value: 0, days: 6 },
    { dow: 4, hour: 17, bills: 20, value: 0, days: 6 },
    { dow: 4, hour: 18, bills: 30, value: 0, days: 6 },
    { dow: 4, hour: 19, bills: 33, value: 0, days: 6 },
  ];
  const base = { history, dow: 4, businessDate: '2026-10-15', openedHour: 10 };

  it('fires for a peak hour that has fully passed with no bill', () => {
    const out = noSalePeakAlerts({ ...base, todayByHour: new Map([[17, 2]]), nowHour: 19 });
    expect(out.map((a) => a.subject?.id)).toEqual([18]);
    expect(out[0].title).toBe('No sale 6pm–7pm');
  });

  it('never fires for the hour still in progress', () => {
    expect(noSalePeakAlerts({ ...base, todayByHour: new Map([[17, 2]]), nowHour: 18 })).toEqual([]);
  });

  it('stays quiet without four weeks of that weekday, or once the shift is closed', () => {
    const thin = history.map((c) => ({ ...c, days: 3 }));
    expect(noSalePeakAlerts({ ...base, history: thin, todayByHour: new Map(), nowHour: 21 })).toEqual([]);
    expect(noSalePeakAlerts({ ...base, todayByHour: new Map(), nowHour: null })).toEqual([]);
  });

  it('ignores peak hours before the shop opened', () => {
    expect(noSalePeakAlerts({ ...base, openedHour: 19, todayByHour: new Map(), nowHour: 21 }).map((a) => a.subject?.id)).toEqual([19]);
  });
});

describe('high return rate (alert #1)', () => {
  it('needs both >15% and at least 20 bills', () => {
    const out = returnRateAlerts(
      [
        { userId: 1, name: 'A', bills: 20, sold: 40, returned: 7 },
        { userId: 2, name: 'B', bills: 19, sold: 40, returned: 20 },
        { userId: 3, name: 'C', bills: 30, sold: 40, returned: 6 },
      ],
      '2026-10-15'
    );
    expect(out.map((a) => a.subject?.id)).toEqual([1]);
  });
});

describe('insights (§9)', () => {
  const quietHours: HourCell[] = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((hour) => ({
    dow: 4,
    hour,
    bills: hour === 10 || hour === 21 ? 1 : hour === 13 || hour === 14 ? 3 : 20,
    value: 0,
    days: 4,
  }));
  const base: InsightInputs = {
    businessDate: '2026-10-15',
    dow: 4,
    returnPatterns: [],
    yoy: null,
    hourly8w: [],
    hourly4w: quietHours,
    topCategoryTomorrow: null,
    loyaltyExpiringCustomers: 0,
    activeAlerts: [],
    dismissed: new Set(),
  };

  it('names the slow stretch in the middle of the day, not opening or closing', () => {
    const i = chooseInsight(base);
    expect(i?.type).toBe('slow_hour');
    expect(i?.text).toMatch(/^1pm–3pm/);
  });

  it('does not repeat a return pattern the alert panel already shows (§8.1)', () => {
    const withPattern = { ...base, returnPatterns: [{ productId: 7, name: 'Peach kurti', count: 3 }] };
    expect(chooseInsight(withPattern)?.type).toBe('return_pattern');
    const alerted: DashboardAlert = {
      key: 'alert:repeat_return:7:2026-10-15',
      type: 'repeat_return_sku',
      severity: 'red',
      title: '',
      detail: '',
      subject: { kind: 'product', id: 7 },
    };
    expect(chooseInsight({ ...withPattern, activeAlerts: [alerted] })?.type).toBe('slow_hour');
  });

  it('moves on to the next rule once one is dismissed', () => {
    const first = chooseInsight({ ...base, loyaltyExpiringCustomers: 4 })!;
    const next = chooseInsight({ ...base, loyaltyExpiringCustomers: 4, dismissed: new Set([first.key]) });
    expect(next?.type).toBe('loyalty_nudge');
  });

  it('celebrates being well ahead of last year, and not when behind', () => {
    const ahead = candidateInsights({ ...base, yoy: { current: 122000, lastYear: 100000, periodLabel: 'today' } });
    expect(ahead.find((x) => x.type === 'yoy_milestone')?.text).toMatch(/^22% ahead of last year today/);
    const behind = candidateInsights({ ...base, yoy: { current: 90000, lastYear: 100000, periodLabel: 'today' } });
    expect(behind.find((x) => x.type === 'yoy_milestone')).toBeUndefined();
  });

  it('flags a strong tomorrow from the weekday averages', () => {
    const week: HourCell[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      dow,
      hour: 18,
      bills: 10,
      value: dow === 5 ? 160000 : 100000,
      days: 8,
    }));
    const out = candidateInsights({ ...base, hourly8w: week, topCategoryTomorrow: 'Cordsets' });
    expect(out.find((x) => x.type === 'day_of_week')?.text).toBe('Fridays run 60% above other days. Stock up Cordsets tonight.');
  });
});

describe('cash in drawer tier (§5.3)', () => {
  it('needs both the percentage and the absolute floor', () => {
    expect(eodTier(-40, 1000)).toBe('good'); // 4% but under ₹50
    expect(eodTier(-60, 2000)).toBe('attention'); // 3% and over ₹50
    expect(eodTier(-150, 10000)).toBe('good'); // 1.5%
    expect(eodTier(-300, 5000)).toBe('critical'); // 6% and over ₹200
    expect(eodTier(250, 0)).toBe('critical'); // over, with no cash sales at all
  });
});

describe('cost coverage (§3.1)', () => {
  it('hides at 90% and above, amber below, red below 75%', () => {
    expect(coverageLevel(95)).toBe('ok');
    expect(coverageLevel(90)).toBe('ok');
    expect(coverageLevel(89.9)).toBe('amber');
    expect(coverageLevel(74.9)).toBe('red');
    expect(coverageLevel(null)).toBe('ok');
  });
});
