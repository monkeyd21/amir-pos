import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

/**
 * §13.3/bug6 — scanning an article must charge the pre-stored Sale Price.
 *
 * The counter used to charge the MRP, so the cashier keyed a manual discount on
 * every line just to reach the price the article was actually selling at. The
 * Sale Price was already stored on the variant and printed on the barcode
 * label, so that keying was avoidable work and a standing source of error.
 *
 * The MRP must still travel with the line — the receipt prints it struck
 * through as the "was" price — it just no longer decides what is charged.
 */
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.clearAllMocks();
});

const product = {
  name: 'Cordset',
  mrp: 1000,
  basePrice: 900,
  costPrice: 400,
  cgstRate: 0,
  sgstRate: 0,
  priceIncludesTax: true,
  brand: { id: 1, name: 'House' },
  category: { id: 1, name: 'Kids' },
};

const variant = {
  id: 11,
  productId: 1,
  sku: 'CRD-24-BLU',
  barcode: '1234567890123',
  size: '24',
  color: 'Blue',
  lotCode: null,
  mrpOverride: 1200, // this size's own MRP
  priceOverride: 1080, // ...and its own Sale Price
  costOverride: 500,
  clearanceFlag: false,
  clearancePrice: null,
  isActive: true,
  product,
};

const lookup = (v: Record<string, unknown>) => {
  prismaMock.productVariant.findFirst.mockResolvedValue(v);
  prismaMock.productVariant.findUnique.mockResolvedValue(v);
  prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 11, branchId: 1, quantity: 5 });
  return request(app)
    .get(`/api/v1/pos/lookup/${(v as any).barcode}`)
    .set('Authorization', authHeader(testUsers.cashier))
    .set('X-Branch-Id', '1');
};

describe('POS scan pricing (bug6)', () => {
  it('charges the variant Sale Price, not the MRP', async () => {
    const res = await lookup(variant);

    expect(res.status).toBe(200);
    expect(Number(res.body.data.price)).toBe(1080); // priceOverride
    expect(Number(res.body.data.price)).not.toBe(1200); // mrpOverride
  });

  it('still carries the MRP for the struck-through "was" price', async () => {
    const res = await lookup(variant);

    expect(Number(res.body.data.mrp)).toBe(1200);
  });

  it('falls back to the product Sale Price when the variant has no override', async () => {
    const res = await lookup({ ...variant, priceOverride: null });

    expect(Number(res.body.data.price)).toBe(900); // product.basePrice
  });

  it('falls back to MRP only when no Sale Price exists anywhere (legacy rows)', async () => {
    const res = await lookup({
      ...variant,
      priceOverride: null,
      product: { ...product, basePrice: null },
    });

    expect(Number(res.body.data.price)).toBe(1200); // mrpOverride
  });

  it('a clearance line still charges its fixed clearance price', async () => {
    const res = await lookup({ ...variant, clearanceFlag: true, clearancePrice: 350 });

    expect(Number(res.body.data.price)).toBe(350);
    expect(res.body.data.clearance).toBe(true);
  });

  it('uplifts a tax-exclusive Sale Price to the inclusive counter price', async () => {
    const res = await lookup({
      ...variant,
      priceOverride: 1000,
      product: { ...product, priceIncludesTax: false, cgstRate: 2.5, sgstRate: 2.5 },
    });

    expect(Number(res.body.data.price)).toBe(1050);
  });
});
