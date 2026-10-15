import { autoMatch, CreditIn, PaymentIn } from '../matching';

const t = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00+05:30`);
const credit = (id: number, amount: number, at: string, reference = `UTR${id}000000`): CreditIn => ({
  id,
  amount,
  reference,
  receivedAt: t(at),
});
const payment = (id: number, amount: number, at: string, referenceNumber: string | null = null): PaymentIn => ({
  id,
  saleId: id * 10,
  amount,
  referenceNumber,
  createdAt: t(at),
});

describe('UPI credit auto-matching (§15.5)', () => {
  it('matches on the UTR whatever the time', () => {
    const out = autoMatch([credit(1, 1200, '18:00', '4321 9876 5555')], [payment(7, 1200, '11:00', '432198765555')], []);
    expect(out).toEqual([{ creditId: 1, kind: 'payment', paymentId: 7, saleId: 70, method: 'reference' }]);
  });

  it('refuses a UTR match when the amount differs', () => {
    expect(autoMatch([credit(1, 1200, '18:00', 'ABC123456')], [payment(7, 1100, '18:00', 'ABC123456')], [])).toEqual([]);
  });

  it('matches one amount within the window', () => {
    const out = autoMatch([credit(1, 1450, '18:10')], [payment(5, 1450, '18:02')], []);
    expect(out[0]).toMatchObject({ creditId: 1, paymentId: 5, method: 'amount_time' });
  });

  it('leaves two look-alike credits for a person rather than guess', () => {
    const out = autoMatch([credit(1, 1200, '18:00'), credit(2, 1200, '18:04')], [payment(5, 1200, '18:01')], []);
    expect(out).toEqual([]);
  });

  it('leaves a credit with two look-alike bills for a person', () => {
    expect(autoMatch([credit(1, 1200, '18:00')], [payment(5, 1200, '17:55'), payment(6, 1200, '18:05')], [])).toEqual([]);
  });

  it('ignores a payment outside the window', () => {
    expect(autoMatch([credit(1, 1200, '18:00')], [payment(5, 1200, '17:10')], [])).toEqual([]);
  });

  it('falls back to a pending sale taken by UPI', () => {
    const out = autoMatch([credit(1, 950, '16:00')], [], [{ id: 3, amount: 950, createdAt: t('15:30') }]);
    expect(out).toEqual([{ creditId: 1, kind: 'pending', pendingSaleId: 3, method: 'amount_time' }]);
  });

  it('never uses one payment twice', () => {
    const out = autoMatch(
      [credit(1, 1200, '18:00', 'REF000001'), credit(2, 1200, '18:01')],
      [payment(5, 1200, '18:00', 'REF000001')],
      []
    );
    expect(out.map((m) => m.creditId)).toEqual([1]);
  });
});
