import { poolBundle } from '../engine';

/**
 * "3 for Rs. 1200" means ANY three pieces the offer covers.
 *
 * The shop sells one piece per size, so three of one variant is a basket that
 * can never exist on their rail: a customer buying three KIDDY CORDS buys three
 * different sizes, which reach the cart as three lines of one. Priced line by
 * line the deal never fired, and at three pieces the bill read 1740 instead of
 * 1200.
 *
 * These pin the pooled arithmetic and, just as importantly, the split back onto
 * the lines — a refund pays `SaleItem.total ÷ quantity`, so a customer handing
 * back one piece of a three-for-1200 must get its share of the deal.
 */
const bundle = (over: Partial<any> = {}): any => ({
  id: 5,
  name: 'Buy 3 for 1200',
  type: 'bundle',
  buyQty: 3,
  flatValue: 1200,
  priority: 5,
  ...over,
});

/** Three different sizes at Rs 630, one piece of each: the shop's real basket. */
const threeSizes = [
  { index: 0, unitPrice: 630, quantity: 1 },
  { index: 1, unitPrice: 630, quantity: 1 },
  { index: 2, unitPrice: 630, quantity: 1 },
];

describe('pooled bundles', () => {
  it('fires on three different variants, one piece each', () => {
    const p = poolBundle(bundle(), threeSizes);
    expect(p.qualified).toBe(true);
    // 3 x 630 = 1890 gross, charged 1200.
    expect(p.discountAmount).toBe(690);
    expect([...p.byLine.values()]).toEqual([230, 230, 230]);
  });

  it('still fires on three of one variant', () => {
    const p = poolBundle(bundle(), [{ index: 0, unitPrice: 630, quantity: 3 }]);
    expect(p.qualified).toBe(true);
    expect(p.discountAmount).toBe(690);
    expect(p.byLine.get(0)).toBe(690);
  });

  it('counts pieces across different articles the offer covers', () => {
    // A 630 piece, a 550 piece and a 400 piece from three separate articles.
    const p = poolBundle(bundle(), [
      { index: 0, unitPrice: 630, quantity: 1 },
      { index: 1, unitPrice: 550, quantity: 1 },
      { index: 2, unitPrice: 400, quantity: 1 },
    ]);
    expect(p.qualified).toBe(true);
    expect(p.discountAmount).toBe(380); // 1580 gross - 1200
    // Apportioned by what each line put in: 630/1580, 550/1580, 400/1580.
    expect([...p.byLine.values()]).toEqual([151.52, 132.28, 96.2]);
    expect([...p.byLine.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(380, 2);
  });

  it('does not fire on two pieces, and says how many more are needed', () => {
    const p = poolBundle(bundle(), threeSizes.slice(0, 2));
    expect(p.qualified).toBe(false);
    expect(p.shortfall).toBe(1);
    expect(p.hint).toBe('Add 1 more for 3 for Rs. 1200');
  });

  it('bundles the DEAREST three and leaves the cheapest at shelf price', () => {
    // 4 pieces: 700, 630, 630, 400. The bundle should take 700+630+630.
    const p = poolBundle(bundle(), [
      { index: 0, unitPrice: 700, quantity: 1 },
      { index: 1, unitPrice: 630, quantity: 2 },
      { index: 2, unitPrice: 400, quantity: 1 },
    ]);
    expect(p.qualified).toBe(true);
    expect(p.discountAmount).toBe(760); // 1960 - 1200
    // The 400 piece is outside the deal, so its line gets nothing.
    expect(p.byLine.has(2)).toBe(false);
    // 760 apportioned by what each line put in: 700/1960 and 1260/1960.
    expect(p.byLine.get(0)).toBe(271.43);
    expect(p.byLine.get(1)).toBe(488.57);
    expect(p.byLine.get(0)! + p.byLine.get(1)!).toBeCloseTo(760, 2);
  });

  it('applies twice over six pieces', () => {
    const p = poolBundle(bundle(), [
      { index: 0, unitPrice: 630, quantity: 4 },
      { index: 1, unitPrice: 630, quantity: 2 },
    ]);
    expect(p.qualified).toBe(true);
    // 6 x 630 = 3780, charged 2 x 1200 = 2400.
    expect(p.discountAmount).toBe(1380);
  });

  it('never applies a bundle that costs more than the pieces', () => {
    // 3 pieces at 300 = 900 on the shelf; "3 for 1200" would be a surcharge.
    const p = poolBundle(bundle(), [
      { index: 0, unitPrice: 300, quantity: 3 },
    ]);
    expect(p.qualified).toBe(false);
    expect(p.discountAmount).toBe(0);
  });

  it('splits with no drift, so the parts always sum to the whole', () => {
    // Prices chosen so the proportional split does not divide evenly.
    const p = poolBundle(bundle({ flatValue: 1000 }), [
      { index: 0, unitPrice: 333.33, quantity: 1 },
      { index: 1, unitPrice: 333.33, quantity: 1 },
      { index: 2, unitPrice: 633.34, quantity: 1 },
    ]);
    const sum = [...p.byLine.values()].reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(p.discountAmount);
  });

  it('ignores a bundle with no quantity or no price set', () => {
    expect(poolBundle(bundle({ buyQty: 0 }), threeSizes).qualified).toBe(false);
    expect(poolBundle(bundle({ flatValue: 0 }), threeSizes).qualified).toBe(false);
  });

  it('ignores an offer that is not a bundle', () => {
    expect(poolBundle(bundle({ type: 'flat' }), threeSizes).qualified).toBe(false);
  });

  it('is empty for an empty basket', () => {
    expect(poolBundle(bundle(), []).qualified).toBe(false);
  });
});
