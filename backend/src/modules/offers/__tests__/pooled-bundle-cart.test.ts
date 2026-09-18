import { evaluateCart } from '../engine';
import { prismaMock } from '../../../__tests__/setup';

/**
 * The pooled bundle as the cart actually sees it, with the shop's real setup:
 * "Rs 50 OFF" assigned at VARIANT level, "3 for Rs 1200" at PRODUCT level, one
 * article, three sizes at Rs 630.
 *
 * The per-line tests cover the arithmetic; these cover the choosing: when the
 * bundle takes over from the flat offer, that it takes over across LINES rather
 * than needing three of one size, and that units left outside the deal keep the
 * offer they would have had on their own.
 */
const flat = {
  id: 2,
  name: 'One for 500',
  type: 'flat',
  flatValue: 50,
  percentValue: null,
  buyQty: null,
  getQty: null,
  priority: 1,
  createdAt: new Date('2026-09-01'),
};
const bundle = {
  id: 5,
  name: 'Buy 3 for 1200',
  type: 'bundle',
  flatValue: 1200,
  percentValue: null,
  buyQty: 3,
  getQty: null,
  priority: 5,
  createdAt: new Date('2026-09-02'),
};

/** Variants 16, 17, 18 are three sizes of product 2, at Rs 630 each. */
function mockOffers() {
  prismaMock.productVariant.findMany.mockResolvedValue([
    { id: 16, productId: 2 },
    { id: 17, productId: 2 },
    { id: 18, productId: 2 },
  ]);
  prismaMock.offer.findMany.mockResolvedValue([
    {
      ...bundle,
      variants: [],
      products: [{ productId: 2 }],
    },
    {
      ...flat,
      variants: [{ variantId: 16 }, { variantId: 17 }, { variantId: 18 }],
      products: [],
    },
  ]);
}

const line = (variantId: number, quantity: number) => ({
  variantId,
  quantity,
  unitPrice: 630,
});

const billTotal = (rows: Array<{ result: { lineTotal: number } | null; line: { unitPrice: number; quantity: number } }>) =>
  Math.round(
    rows.reduce(
      (sum, r) => sum + (r.result?.lineTotal ?? r.line.unitPrice * r.line.quantity),
      0
    ) * 100
  ) / 100;

beforeEach(() => jest.clearAllMocks());

describe('a bundle priced over the cart', () => {
  it('leaves one piece on the flat offer, and says how many more are needed', async () => {
    mockOffers();
    const rows = await evaluateCart([line(16, 1)]);
    expect(rows[0].offer?.id).toBe(flat.id);
    expect(billTotal(rows)).toBe(580);
    expect(rows[0].upcomingHint).toBe('Add 2 more for 3 for Rs. 1200');
  });

  it('fires on three DIFFERENT sizes, which is the whole point', async () => {
    mockOffers();
    const rows = await evaluateCart([line(16, 1), line(17, 1), line(18, 1)]);
    expect(rows.map((r) => r.offer?.id)).toEqual([bundle.id, bundle.id, bundle.id]);
    // 3 x 630 = 1890 on the shelf, 1200 with the deal.
    expect(billTotal(rows)).toBe(1200);
    // Every line prices at the bundle's per-piece average, so a refund of any
    // one piece gives back its share of the deal and not the shelf price.
    expect(rows.map((r) => r.result?.effectiveUnitPrice)).toEqual([400, 400, 400]);
  });

  it('beats the flat offer only when it is actually better', async () => {
    mockOffers();
    // Two pieces: the bundle cannot apply, so the flat offer must still stand.
    const rows = await evaluateCart([line(16, 1), line(17, 1)]);
    expect(rows.map((r) => r.offer?.id)).toEqual([flat.id, flat.id]);
    expect(billTotal(rows)).toBe(1160);
  });

  it('prices the fourth piece on the flat offer, not at shelf price', async () => {
    mockOffers();
    const rows = await evaluateCart([line(16, 2), line(17, 1), line(18, 1)]);
    // 1200 for three + 580 for the one left over.
    expect(billTotal(rows)).toBe(1780);
  });

  it('keeps the flat offer on units left outside a straddled line', async () => {
    mockOffers();
    // 2 + 2 + 1: the bundle takes three units, one line is split across it.
    // The two pieces outside the deal must still get Rs 50 each, or the bill
    // would depend on how the cart happened to split.
    const rows = await evaluateCart([line(16, 2), line(17, 2), line(18, 1)]);
    expect(billTotal(rows)).toBe(2360); // 1200 + 580 + 580
  });

  it('applies twice over six pieces spread across sizes', async () => {
    mockOffers();
    const rows = await evaluateCart([line(16, 2), line(17, 2), line(18, 2)]);
    expect(billTotal(rows)).toBe(2400);
  });
});
