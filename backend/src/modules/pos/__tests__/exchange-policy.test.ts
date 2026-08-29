import { canExchangeLine, canRefundLine, clearanceCashOutBlocked } from '../exchange-policy';

/**
 * §0/§2.4 — clearance goods are exchangeable but never refundable.
 *
 * Before this, checkout set `nonReturnable: true` on every clearance line and
 * the exchange path rejected anything carrying that flag, so a customer could
 * not swap a clearance size at all. These lock in the split between the refund
 * right and the exchange right, and the equal-or-greater-value guard that keeps
 * the swap from becoming a refund by another name.
 */
const line = (over: Partial<Parameters<typeof canExchangeLine>[0]> = {}) => ({
  isClearance: false,
  lineNonReturnable: false,
  productNonReturnable: false,
  ...over,
});

describe('exchange policy', () => {
  describe('canExchangeLine', () => {
    it('allows a clearance line to be exchanged (the bug)', () => {
      // Clearance sets lineNonReturnable at checkout; that must not block a swap.
      expect(canExchangeLine(line({ isClearance: true, lineNonReturnable: true }))).toBe(true);
    });

    it('allows an ordinary line', () => {
      expect(canExchangeLine(line())).toBe(true);
    });

    it('still blocks a cashier-flagged non-clearance line', () => {
      expect(canExchangeLine(line({ lineNonReturnable: true }))).toBe(false);
    });

    it('still blocks a non-returnable PRODUCT, even on clearance', () => {
      // The product flag is about the goods, not the price paid — it outranks
      // the clearance allowance.
      expect(
        canExchangeLine(line({ isClearance: true, productNonReturnable: true }))
      ).toBe(false);
    });
  });

  describe('canRefundLine', () => {
    it('never refunds a clearance line', () => {
      expect(canRefundLine(line({ isClearance: true }))).toBe(false);
    });

    it('refunds an ordinary line', () => {
      expect(canRefundLine(line())).toBe(true);
    });

    it('does not refund a cashier-flagged or product-flagged line', () => {
      expect(canRefundLine(line({ lineNonReturnable: true }))).toBe(false);
      expect(canRefundLine(line({ productNonReturnable: true }))).toBe(false);
    });
  });

  describe('clearanceCashOutBlocked', () => {
    it('blocks when a clearance-backed exchange would pay cash out', () => {
      // ₹700 clearance item returned against a ₹200 replacement = ₹500 payout.
      expect(clearanceCashOutBlocked(700, 500)).toBe(true);
    });

    it('allows an even swap', () => {
      expect(clearanceCashOutBlocked(700, 0)).toBe(false);
    });

    it('allows an upgrade — customer pays the difference', () => {
      expect(clearanceCashOutBlocked(700, 0)).toBe(false);
    });

    it('does not interfere when no clearance goods are involved', () => {
      // A normal exchange may still refund the difference at the counter.
      expect(clearanceCashOutBlocked(0, 500)).toBe(false);
    });

    it('ignores sub-paisa float noise', () => {
      expect(clearanceCashOutBlocked(700, 0.00005)).toBe(false);
    });
  });
});
