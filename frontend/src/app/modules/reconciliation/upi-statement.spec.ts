import { guessColumns, parseAmount, parseCsv, parseStatementDate, toCredits } from './upi-statement';

describe('UPI statement import', () => {
  it('parses quoted CSV with commas and escaped quotes', () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('reads Indian statement dates as IST', () => {
    // 15-10-2026 18:30 IST is 13:00 UTC.
    expect(parseStatementDate('15-10-2026 18:30')).toBe('2026-10-15T13:00:00.000Z');
    expect(parseStatementDate('15/10/2026 06:30 PM')).toBe('2026-10-15T13:00:00.000Z');
    expect(parseStatementDate('15-Oct-2026 18:30:00')).toBe('2026-10-15T13:00:00.000Z');
    expect(parseStatementDate('2026-10-15 18:30')).toBe('2026-10-15T13:00:00.000Z');
    expect(parseStatementDate('15/10/26')).toBe('2026-10-14T18:30:00.000Z');
  });

  it('refuses impossible dates rather than rolling them over', () => {
    expect(parseStatementDate('31-02-2026 10:00')).toBeNull();
    expect(parseStatementDate('15-10-2026 25:00')).toBeNull();
    expect(parseStatementDate('yesterday')).toBeNull();
  });

  it('reads amounts in the formats banks print', () => {
    expect(parseAmount('₹1,20,000.50')).toBe(120000.5);
    expect(parseAmount('1200 Cr')).toBe(1200);
    expect(parseAmount('500.00 Dr')).toBe(-500);
    expect(parseAmount('(500.00)')).toBe(-500);
    expect(parseAmount('')).toBeNull();
  });

  it('guesses the usual column names', () => {
    const map = guessColumns(['Txn Date', 'Description', 'UTR No', 'Payer Name', 'Payer VPA', 'Amount', 'Cr/Dr']);
    expect(map).toEqual({ date: 0, amount: 5, reference: 2, payerName: 3, payerVpa: 4, direction: 6 });
  });

  it('keeps credits and says why everything else was skipped', () => {
    const map = guessColumns(['Date', 'UTR', 'Amount', 'Cr/Dr']);
    const res = toCredits(
      [
        ['15-10-2026 18:30', '432198765555', '1,450.00', 'CR'],
        ['15-10-2026 18:31', '432198765556', '200.00', 'DR'],
        ['nonsense', '432198765557', '300', 'CR'],
        ['15-10-2026 18:40', '', '300', 'CR'],
      ],
      map
    );
    expect(res.rows).toEqual([
      { receivedAt: '2026-10-15T13:00:00.000Z', amount: 1450, reference: '432198765555', payerName: null, payerVpa: null },
    ]);
    expect(res.skipped.map((s) => s.reason)).toEqual(['Debit', 'Unreadable date "nonsense"', 'No reference / UTR']);
  });
});
