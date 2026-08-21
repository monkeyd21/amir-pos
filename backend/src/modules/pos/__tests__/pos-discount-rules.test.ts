import { checkoutSchema } from '../validators';

/**
 * Locks in two deliberate relaxations to the POS discount rules:
 *
 *  1. `specialDiscount` MAY be negative — a negative special discount is a
 *     surcharge that raises the payable (delivery/alteration charge). It used
 *     to be rejected by `z.number().min(0)`, which surfaced at the counter as
 *     "specialDiscount: Number must be greater than or equal to 0".
 *  2. `discretionaryPct` (Owner Discretion Discount) no longer stops at 15%.
 *     The Owner PIN is the gate; the only remaining bound is a sane 0–100%.
 */
const baseBody = () => ({
  items: [{ barcode: 'SE06370', quantity: 1 }],
  payments: [{ method: 'cash' as const, amount: 700 }],
});

const parse = (body: Record<string, unknown>) =>
  checkoutSchema.safeParse({ body: { ...baseBody(), ...body } });

describe('POS discount rules', () => {
  describe('special discount', () => {
    it('accepts a NEGATIVE special discount (surcharge)', () => {
      const res = parse({ specialDiscount: -10, discountAmount: 210 });
      expect(res.success).toBe(true);
    });

    it('accepts a large negative special discount', () => {
      const res = parse({ specialDiscount: -2500, discountAmount: -2500 });
      expect(res.success).toBe(true);
    });

    it('still accepts a positive special discount', () => {
      expect(parse({ specialDiscount: 50, discountAmount: 50 }).success).toBe(true);
    });

    it('accepts a bill-level discountAmount below the old -10 floor', () => {
      // discountAmount is manual + special + round-off. A negative special
      // discount can push it arbitrarily negative, so the old gte(-10) floor
      // would have rejected a legitimate bill.
      expect(parse({ discountAmount: -450, specialDiscount: -450 }).success).toBe(true);
    });
  });

  describe('owner discretion discount', () => {
    const withPct = (pct: number) =>
      checkoutSchema.safeParse({
        body: {
          ...baseBody(),
          ownerPin: '1234',
          items: [{ barcode: 'SE06370', quantity: 1, discretionaryPct: pct }],
        },
      });

    it('accepts an OD above the old 15% ceiling', () => {
      expect(withPct(40).success).toBe(true);
    });

    it('accepts a 100% OD', () => {
      expect(withPct(100).success).toBe(true);
    });

    it('still rejects a negative OD', () => {
      expect(withPct(-1).success).toBe(false);
    });

    it('still rejects an OD above 100% — cannot discount more than the line', () => {
      expect(withPct(101).success).toBe(false);
    });
  });
});
