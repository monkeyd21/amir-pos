import {
  canApproveExchangeOverride,
  carriedCustomerId,
  findPriorExchange,
  oneExchangePerBillMessage,
} from '../exchange-limit';

/**
 * §0 one exchange per bill: the BILL-level guard.
 *
 * Separate from `exchange-policy.ts`, which decides line by line what may be
 * refunded versus swapped. These lock in the two things this guard has to get
 * right: telling a refund apart from an exchange, and refusing to let a cashier
 * wave the policy through on their own.
 */
const ret = (over: Record<string, unknown> = {}) => ({
  id: 1,
  returnNumber: 'RT-0001',
  type: 'return',
  createdAt: new Date('2026-09-05T06:00:00Z'),
  ...over,
});

describe('one exchange per bill', () => {
  describe('findPriorExchange', () => {
    it('finds nothing on a bill that has never been returned against', () => {
      expect(findPriorExchange([])).toBeNull();
      expect(findPriorExchange(null)).toBeNull();
      expect(findPriorExchange(undefined)).toBeNull();
    });

    it('does NOT count a plain refund, so a refunded bill keeps its exchange', () => {
      // The policy is one EXCHANGE per bill. A customer who came back once for
      // money has not used the swap, and must not be told they have.
      expect(findPriorExchange([ret({ type: 'return' })])).toBeNull();
      expect(
        findPriorExchange([ret({ id: 1, type: 'return' }), ret({ id: 2, type: 'return' })])
      ).toBeNull();
    });

    it('finds a prior exchange and reports the date it happened', () => {
      const prior = findPriorExchange([
        ret({ id: 7, type: 'exchange', returnNumber: 'RT-0007' }),
      ]);
      expect(prior).not.toBeNull();
      expect(prior!.id).toBe(7);
      expect(prior!.returnNumber).toBe('RT-0007');
      // 06:00 UTC is 11:30 IST on the same day.
      expect(prior!.dateLabel).toBe('5 Sep 2026');
      expect(prior!.createdAt).toBe('2026-09-05T06:00:00.000Z');
    });

    it('reads a date that arrived as an ISO string over JSON', () => {
      const prior = findPriorExchange([
        ret({ type: 'exchange', createdAt: '2026-01-31T20:00:00.000Z' }),
      ]);
      // 20:00 UTC on 31 Jan is 01:30 IST on 1 Feb, and the IST day is what shows.
      expect(prior!.dateLabel).toBe('1 Feb 2026');
    });

    it('picks the exchange out of a mixed history of refunds', () => {
      const prior = findPriorExchange([
        ret({ id: 1, type: 'return', createdAt: new Date('2026-09-01T06:00:00Z') }),
        ret({ id: 2, type: 'exchange', returnNumber: 'RT-0002', createdAt: new Date('2026-09-03T06:00:00Z') }),
        ret({ id: 3, type: 'return', createdAt: new Date('2026-09-04T06:00:00Z') }),
      ]);
      expect(prior!.id).toBe(2);
      expect(prior!.dateLabel).toBe('3 Sep 2026');
    });

    it('reports the EARLIEST exchange, the one that used up the allowance', () => {
      const prior = findPriorExchange([
        ret({ id: 9, type: 'exchange', returnNumber: 'RT-0009', createdAt: new Date('2026-09-08T06:00:00Z') }),
        ret({ id: 4, type: 'exchange', returnNumber: 'RT-0004', createdAt: new Date('2026-09-02T06:00:00Z') }),
      ]);
      expect(prior!.returnNumber).toBe('RT-0004');
      expect(prior!.dateLabel).toBe('2 Sep 2026');
    });
  });

  describe('canApproveExchangeOverride', () => {
    it('lets an owner or a manager approve', () => {
      expect(canApproveExchangeOverride('owner')).toBe(true);
      expect(canApproveExchangeOverride('manager')).toBe(true);
    });

    it('does not let a cashier or staff member approve on their own', () => {
      expect(canApproveExchangeOverride('cashier')).toBe(false);
      expect(canApproveExchangeOverride('staff')).toBe(false);
    });

    it('refuses a missing role', () => {
      expect(canApproveExchangeOverride(null)).toBe(false);
      expect(canApproveExchangeOverride(undefined)).toBe(false);
      expect(canApproveExchangeOverride('')).toBe(false);
    });
  });

  describe('oneExchangePerBillMessage', () => {
    it('tells the cashier the bill, the date and the way through', () => {
      const prior = findPriorExchange([
        ret({ id: 7, type: 'exchange', returnNumber: 'RT-0007' }),
      ])!;
      const msg = oneExchangePerBillMessage('W-0007', prior);
      expect(msg).toContain('W-0007');
      expect(msg).toContain('5 Sep 2026');
      expect(msg).toContain('RT-0007');
      expect(msg).toContain('one exchange per bill');
      expect(msg).toMatch(/manager or owner/i);
    });
  });

  describe('carriedCustomerId', () => {
    it('carries the original bill customer across to the replacement', () => {
      expect(carriedCustomerId(undefined, 9)).toBe(9);
      expect(carriedCustomerId(null, 9)).toBe(9);
    });

    it('carries nobody from a walk-in bill, the ordinary case, not an error', () => {
      expect(carriedCustomerId(undefined, null)).toBeNull();
      expect(carriedCustomerId(null, undefined)).toBeNull();
    });

    it('never overrides a customer the cashier chose explicitly', () => {
      expect(carriedCustomerId(4, 9)).toBe(4);
      expect(carriedCustomerId(4, null)).toBe(4);
    });
  });
});
