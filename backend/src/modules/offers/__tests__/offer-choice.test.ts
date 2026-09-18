import { Offer } from '@prisma/client';
import { chooseBestOffer, computeDiscount, OfferCandidate } from '../engine';

/**
 * The shop reported this from the counter:
 *
 *   One article, two live offers.
 *     Offer A — "Buy 1, get Rs 50 off the sale price"  (flat, Rs 50 per unit)
 *     Offer B — "Buy 3 for Rs 1200"                    (bundle)
 *
 *   With 1 or 2 in the cart, A should apply. The moment the 3rd unit is
 *   scanned, B should take over and the line should price at Rs 1200.
 *
 * It did not: the engine picked ONE offer per line by priority BEFORE it
 * looked at the quantity, so whichever offer lost the priority tie was never
 * reconsidered as the quantity grew. These tests pin the rule that replaced it:
 * the offer that is best for the customer AT THE CURRENT QUANTITY wins, and it
 * is re-decided on every evaluation; priority only breaks genuine ties.
 */

const SALE_PRICE = 500;

let nextId = 1;
const offer = (o: Partial<Offer> & Pick<Offer, 'type'>): Offer =>
  ({
    id: nextId++,
    name: 'Offer',
    description: null,
    percentValue: null,
    flatValue: null,
    buyQty: null,
    getQty: null,
    priority: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    onlineEligible: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...o,
  }) as Offer;

const rs50Off = (priority: number) =>
  offer({ name: 'Rs 50 off', type: 'flat', flatValue: 50 as any, priority });

const threeFor1200 = (priority: number) =>
  offer({
    name: '3 for Rs 1200',
    type: 'bundle',
    buyQty: 3,
    flatValue: 1200 as any,
    priority,
  });

const atProductLevel = (...offers: Offer[]): OfferCandidate[] =>
  offers.map((o) => ({ offer: o, scope: 'product' as const }));

const choose = (candidates: OfferCandidate[], quantity: number) =>
  chooseBestOffer(candidates, SALE_PRICE, quantity);

beforeEach(() => {
  nextId = 1;
});

describe('two offers on one article, walked up the quantity ladder', () => {
  // Gross is qty × 500. Flat saves 50/unit. The bundle prices every 3 units at
  // 1200 and leaves the remainder at 500 each.
  const ladder: Array<{
    qty: number;
    winner: string;
    lineTotal: number;
    why: string;
  }> = [
    { qty: 1, winner: 'Rs 50 off', lineTotal: 450, why: 'bundle needs 3, flat is all there is' },
    { qty: 2, winner: 'Rs 50 off', lineTotal: 900, why: 'still one short of the bundle' },
    { qty: 3, winner: '3 for Rs 1200', lineTotal: 1200, why: 'bundle beats 1350 the moment it is reachable' },
    { qty: 4, winner: '3 for Rs 1200', lineTotal: 1700, why: '1200 + one at 500 beats 4 × 450' },
    { qty: 6, winner: '3 for Rs 1200', lineTotal: 2400, why: 'two bundles beat 6 × 450' },
  ];

  describe.each([
    ['the flat offer carries the higher priority', 10, 5],
    ['the bundle carries the higher priority', 5, 10],
    ['the two offers are tied on priority', 7, 7],
  ])('%s', (_label, flatPriority, bundlePriority) => {
    const candidates = () =>
      atProductLevel(rs50Off(flatPriority), threeFor1200(bundlePriority));

    it.each(ladder)(
      'qty $qty → $winner, line total Rs $lineTotal ($why)',
      ({ qty, winner, lineTotal }) => {
        const choice = choose(candidates(), qty);
        expect(choice?.offer.name).toBe(winner);
        expect(choice?.result.qualified).toBe(true);
        expect(choice?.result.lineTotal).toBe(lineTotal);
      }
    );
  });

  it('hands the line back to the flat offer when the 3rd unit is removed', () => {
    const candidates = atProductLevel(rs50Off(10), threeFor1200(5));
    expect(choose(candidates, 3)?.offer.name).toBe('3 for Rs 1200');
    expect(choose(candidates, 2)?.offer.name).toBe('Rs 50 off');
  });

  it('nudges the cashier towards the bundle while the flat offer is applied', () => {
    const choice = choose(atProductLevel(rs50Off(10), threeFor1200(5)), 2);
    expect(choice?.result.qualified).toBe(true);
    expect(choice?.upcoming?.result.hint).toBe('Add 1 more for 3 for Rs. 1200');
  });

  it('drops the nudge once the bundle is the offer being applied', () => {
    const choice = choose(atProductLevel(rs50Off(10), threeFor1200(5)), 3);
    expect(choice?.upcoming).toBeUndefined();
  });
});

describe('how a winner is picked', () => {
  it('prefers the bigger discount over the higher priority', () => {
    const small = offer({ name: '5% off', type: 'percentage', percentValue: 5 as any, priority: 900 });
    const big = offer({ name: '30% off', type: 'percentage', percentValue: 30 as any, priority: 1 });
    expect(choose(atProductLevel(small, big), 1)?.offer.name).toBe('30% off');
  });

  it('breaks a genuine tie on priority', () => {
    const a = offer({ name: '10% off', type: 'percentage', percentValue: 10 as any, priority: 1 });
    const b = offer({ name: 'Rs 50 off', type: 'flat', flatValue: 50 as any, priority: 99 });
    // Both take exactly Rs 50 off a single Rs 500 unit.
    expect(computeDiscount(a, SALE_PRICE, 1).discountAmount).toBe(50);
    expect(computeDiscount(b, SALE_PRICE, 1).discountAmount).toBe(50);
    expect(choose(atProductLevel(a, b), 1)?.offer.name).toBe('Rs 50 off');
  });

  it('breaks a tie on priority AND value by the newer offer', () => {
    const older = offer({
      name: 'Old 10%',
      type: 'percentage',
      percentValue: 10 as any,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = offer({
      name: 'New 10%',
      type: 'percentage',
      percentValue: 10 as any,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });
    expect(choose(atProductLevel(older, newer), 1)?.offer.name).toBe('New 10%');
  });

  it('never stacks — one line takes exactly one offer', () => {
    // 4 units: the bundle prices 3 at 1200 and leaves 1 at full price. Stacking
    // the Rs 50 off onto that spare unit would total 1650; we charge 1700.
    const choice = choose(atProductLevel(rs50Off(0), threeFor1200(0)), 4);
    expect(choice?.result.lineTotal).toBe(1700);
  });

  it('returns nothing when the article has no offers', () => {
    expect(choose([], 3)).toBeNull();
  });

  it('never lets a mistyped bundle price raise the bill', () => {
    // 3 × 500 = 1500 on the shelf; "3 for Rs 1600" is a surcharge, not a deal.
    const tooDear = offer({
      name: '3 for Rs 1600',
      type: 'bundle',
      buyQty: 3,
      flatValue: 1600 as any,
    });
    const result = computeDiscount(tooDear, SALE_PRICE, 3);
    expect(result.discountAmount).toBe(0);
    expect(result.lineTotal).toBe(1500);
  });

  it('prefers the real discount over a bundle that would overcharge', () => {
    const tooDear = offer({
      name: '3 for Rs 1600',
      type: 'bundle',
      buyQty: 3,
      flatValue: 1600 as any,
      priority: 900,
    });
    const choice = choose(atProductLevel(tooDear, rs50Off(0)), 3);
    expect(choice?.offer.name).toBe('Rs 50 off');
    expect(choice?.result.lineTotal).toBe(1350);
  });
});

describe('the best deal wins, whatever the offer was attached to', () => {
  it('takes the richer article-wide offer over a thinner variant-level one', () => {
    // Scope used to gate this, and a shop running "Rs 50 off" on variants and
    // "3 for Rs 1200" on the article found the bundle could never apply: the
    // flat offer qualifies at every quantity, so it always won. Targeting is
    // not the same as value, and gating one by the other charged customers
    // more. A variant-level offer can now be beaten, but only by a BIGGER
    // discount, never a smaller one.
    const targeted = offer({ name: 'Variant 5%', type: 'percentage', percentValue: 5 as any });
    const blanket = offer({ name: 'Product 30%', type: 'percentage', percentValue: 30 as any });
    const choice = chooseBestOffer(
      [
        { offer: targeted, scope: 'variant' },
        { offer: blanket, scope: 'product' },
      ],
      SALE_PRICE,
      1
    );
    expect(choice?.offer.name).toBe('Product 30%');
  });

  it('keeps the variant-level offer when it is the better deal', () => {
    const targeted = offer({ name: 'Variant 30%', type: 'percentage', percentValue: 30 as any });
    const blanket = offer({ name: 'Product 5%', type: 'percentage', percentValue: 5 as any });
    const choice = chooseBestOffer(
      [
        { offer: targeted, scope: 'variant' },
        { offer: blanket, scope: 'product' },
      ],
      SALE_PRICE,
      1
    );
    expect(choice?.offer.name).toBe('Variant 30%');
  });

  it('lets the article-wide bundle take a line the variant-level flat offer held', () => {
    // The shop's actual setup, the one that was billing 1740 for three pieces.
    const choice = chooseBestOffer(
      [
        { offer: rs50Off(0), scope: 'variant' },
        { offer: threeFor1200(0), scope: 'product' },
      ],
      SALE_PRICE,
      3
    );
    expect(choice?.offer.name).toBe('3 for Rs 1200');
    expect(choice?.result.lineTotal).toBe(1200);
  });

  it('leaves that same line on the flat offer below the bundle quantity', () => {
    const choice = chooseBestOffer(
      [
        { offer: rs50Off(0), scope: 'variant' },
        { offer: threeFor1200(0), scope: 'product' },
      ],
      SALE_PRICE,
      2
    );
    expect(choice?.offer.name).toBe('Rs 50 off');
    expect(choice?.result.lineTotal).toBe(900);
  });

  it('falls back to the narrower assignment only when the money is identical', () => {
    // Same discount, same priority, same age: scope is the last word, not the
    // first.
    const targeted = offer({ id: 20, name: 'Variant 10%', type: 'percentage', percentValue: 10 as any });
    const blanket = offer({ id: 21, name: 'Product 10%', type: 'percentage', percentValue: 10 as any });
    const choice = chooseBestOffer(
      [
        { offer: blanket, scope: 'product' },
        { offer: targeted, scope: 'variant' },
      ],
      SALE_PRICE,
      1
    );
    expect(choice?.offer.name).toBe('Variant 10%');
  });

  it('falls through to product level when no variant-level offer applies yet', () => {
    // A variant-level bundle out of reach must not swallow the line's discount.
    const choice = chooseBestOffer(
      [
        { offer: threeFor1200(0), scope: 'variant' },
        { offer: rs50Off(0), scope: 'product' },
      ],
      SALE_PRICE,
      2
    );
    expect(choice?.offer.name).toBe('Rs 50 off');
    expect(choice?.result.lineTotal).toBe(900);
  });

  it('gives the variant-level offer the line back as soon as it applies', () => {
    const choice = chooseBestOffer(
      [
        { offer: threeFor1200(0), scope: 'variant' },
        { offer: rs50Off(0), scope: 'product' },
      ],
      SALE_PRICE,
      3
    );
    expect(choice?.offer.name).toBe('3 for Rs 1200');
    expect(choice?.result.lineTotal).toBe(1200);
  });

  it('counts an offer assigned at both levels once, at its narrower scope', () => {
    const both = rs50Off(0);
    const choice = chooseBestOffer(
      [
        { offer: both, scope: 'product' },
        { offer: both, scope: 'variant' },
      ],
      SALE_PRICE,
      1
    );
    expect(choice?.scope).toBe('variant');
    expect(choice?.result.discountAmount).toBe(50);
  });
});

describe('when nothing applies at this quantity', () => {
  it('still reports the deal to chase, with its hint', () => {
    const choice = choose(atProductLevel(threeFor1200(0)), 2);
    expect(choice?.result.qualified).toBe(false);
    expect(choice?.result.discountAmount).toBe(0);
    expect(choice?.result.hint).toBe('Add 1 more for 3 for Rs. 1200');
  });

  it('prefers the offer that has something to say to one that does not', () => {
    const misconfigured = offer({ name: 'Broken', type: 'percentage', percentValue: 0 as any, priority: 500 });
    const choice = choose(atProductLevel(misconfigured, threeFor1200(0)), 1);
    expect(choice?.offer.name).toBe('3 for Rs 1200');
    expect(choice?.result.hint).toBe('Add 2 more for 3 for Rs. 1200');
  });
});
