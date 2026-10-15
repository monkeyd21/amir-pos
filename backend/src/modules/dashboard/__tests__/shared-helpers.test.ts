import {
  canSeeOnDashboard,
  compare,
  comparePoints,
  formatDdMmYyyy,
  formatInr,
  formatInrCompact,
  formatIndianNumber,
  formatIstDate,
  formatIstDateTime,
  formatIstTime,
  isReturnReasonCode,
  parseDdMmYyyy,
  returnReasonLabel,
  validateLegacySaleDate,
} from '@clothing-erp/shared';

describe('Indian formatting', () => {
  it('groups money in lakhs, not millions', () => {
    expect(formatInr(120000)).toBe('₹1,20,000');
    expect(formatInr(18430000)).toBe('₹1,84,30,000');
    expect(formatIndianNumber('4650.5', 2)).toBe('4,650.50');
  });

  it('puts a real minus sign outside the rupee', () => {
    expect(formatInr(-950)).toBe('−₹950');
    expect(formatInr(-0.2)).toBe('₹0');
  });

  it('reads Prisma Decimal strings and survives junk', () => {
    expect(formatInr('237')).toBe('₹237');
    expect(formatInr(null)).toBe('₹0');
    expect(formatInr('abc')).toBe('₹0');
  });

  it('shortens to K, L and Cr', () => {
    expect(formatInrCompact(950)).toBe('₹950');
    expect(formatInrCompact(12400)).toBe('₹12.4K');
    expect(formatInrCompact(184300)).toBe('₹1.84L');
    expect(formatInrCompact(21000000)).toBe('₹2.1Cr');
  });
});

describe('DD-MM-YYYY', () => {
  it('formats a DATE column without sliding a day', () => {
    expect(formatDdMmYyyy('2026-10-15')).toBe('15-10-2026');
    expect(formatDdMmYyyy('2026-10-15T00:00:00.000Z')).toBe('15-10-2026');
    expect(formatDdMmYyyy(new Date(Date.UTC(2026, 0, 3)))).toBe('03-01-2026');
    expect(formatDdMmYyyy(null)).toBe('');
  });

  it('parses the common separators and refuses impossible days', () => {
    expect(parseDdMmYyyy('15-10-2026')).toBe('2026-10-15');
    expect(parseDdMmYyyy('5/1/2026')).toBe('2026-01-05');
    expect(parseDdMmYyyy('31-02-2026')).toBeNull();
    expect(parseDdMmYyyy('2026-10-15')).toBeNull();
  });

  it('validates legacy sale dates per §12.4', () => {
    const today = '2026-10-15';
    expect(validateLegacySaleDate('', today)).toEqual({ ok: false, error: 'Original sale date is required' });
    expect(validateLegacySaleDate('16-10-2026', today).ok).toBe(false);
    expect(validateLegacySaleDate('31-12-2009', today).ok).toBe(false);
    expect(validateLegacySaleDate('01-01-2010', today)).toEqual({ ok: true, ymd: '2010-01-01' });
  });
});

describe('return reasons', () => {
  it('knows the six codes and nothing else', () => {
    expect(isReturnReasonCode('size_issue')).toBe(true);
    expect(isReturnReasonCode('other')).toBe(false);
    expect(returnReasonLabel('colour_mismatch')).toBe('Colour mismatch');
    expect(returnReasonLabel(null)).toBeNull();
  });
});

describe('compare (§2.2)', () => {
  it('never divides by zero', () => {
    expect(compare(100, 0).noData).toBe(true);
    expect(compare(100, null).noData).toBe(true);
  });

  it('treats ±2% as flat', () => {
    expect(compare(102, 100).direction).toBe('flat');
    expect(compare(97.9, 100).direction).toBe('down');
  });

  it('colours by what is good for the shop, not by the arrow', () => {
    expect(compare(118, 100)).toMatchObject({ pct: 18, direction: 'up', good: true });
    expect(compare(118, 100, { higherIsBetter: false })).toMatchObject({ direction: 'up', good: false });
  });

  it('compares rates in points', () => {
    expect(comparePoints(40, 38)).toMatchObject({ delta: 2, direction: 'up', good: true });
    expect(comparePoints(40.3, 40).direction).toBe('flat');
  });
});

describe('dashboard access (§11A)', () => {
  it('shows a supervisor today-only cards on Today alone', () => {
    expect(canSeeOnDashboard('supervisor', 'sales', 'today')).toBe(true);
    expect(canSeeOnDashboard('supervisor', 'sales', 'week')).toBe(false);
    expect(canSeeOnDashboard('supervisor', 'basket', 'week')).toBe(true);
  });

  it('never shows profit below manager', () => {
    for (const role of ['supervisor', 'cashier', 'staff']) {
      expect(canSeeOnDashboard(role, 'profit', 'today')).toBe(false);
    }
    expect(canSeeOnDashboard('manager', 'profit', 'month')).toBe(true);
  });

  it('hides everything from an unknown role', () => {
    expect(canSeeOnDashboard('intruder', 'basket', 'today')).toBe(false);
  });
});

describe('India-time date formatting', () => {
  it('uses the India calendar day, not the device or UTC day', () => {
    // 20:00 UTC on the 14th is 01:30 IST on the 15th.
    expect(formatIstDate('2026-10-14T20:00:00.000Z')).toBe('15-10-2026');
    expect(formatIstDateTime('2026-10-14T20:00:00.000Z')).toBe('15-10-2026, 1:30 am');
  });

  it('reads a stored DATE (UTC midnight) as that same day', () => {
    expect(formatIstDate('2026-10-15T00:00:00.000Z')).toBe('15-10-2026');
  });

  it('writes noon and midnight the way people say them', () => {
    expect(formatIstTime('2026-10-15T06:30:00.000Z')).toBe('12:00 pm');
    expect(formatIstTime('2026-10-14T18:30:00.000Z')).toBe('12:00 am');
    expect(formatIstDate(null)).toBe('');
    expect(formatIstDate('nonsense')).toBe('');
  });
});
