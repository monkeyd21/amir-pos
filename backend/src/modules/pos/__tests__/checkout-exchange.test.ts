import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

/**
 * The POS counter's exchange path: `POST /pos/checkout` with an `exchange`
 * block, which is what the desktop terminal actually calls.
 *
 * Two things are locked in here:
 *  - §exchange-prefill: the replacement bill inherits the ORIGINAL bill's
 *    customer, so the cashier never re-keys someone the shop already knows. A
 *    walk-in original carries nobody and the sale goes through unchanged.
 *  - §0 one exchange per bill: a second swap is stopped, with the earlier
 *    exchange's date, unless a manager's approval rides along.
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

const BASE = '/api/v1/pos';

const soldVariant = {
  id: 5,
  barcode: '1111111111111',
  sku: 'TST-M-BLU',
  size: 'M',
  color: 'Blue',
  priceOverride: null,
  mrpOverride: null,
  costOverride: null,
  landingOverride: null,
  isClearance: false,
  clearancePrice: null,
  isActive: true,
  product: {
    id: 1,
    name: 'Kurta',
    basePrice: 1000,
    mrp: 1000,
    costPrice: 400,
    cgstRate: 0,
    sgstRate: 0,
    priceIncludesTax: true,
    nonReturnable: false,
  },
};

/** A cheaper replacement, so the swap settles as a payout. */
const cheapVariant = {
  id: 6,
  barcode: '2222222222222',
  sku: 'TST-S-RED',
  size: 'S',
  color: 'Red',
  priceOverride: null,
  mrpOverride: null,
  costOverride: null,
  landingOverride: null,
  isClearance: false,
  clearancePrice: null,
  isActive: true,
  product: {
    id: 2,
    name: 'Scarf',
    basePrice: 400,
    mrp: 400,
    costPrice: 150,
    cgstRate: 0,
    sgstRate: 0,
    priceIncludesTax: true,
    nonReturnable: false,
  },
};

const originalSaleItem = {
  id: 10,
  saleId: 1,
  variantId: 5,
  quantity: 1,
  unitPrice: 1000,
  taxAmount: 0,
  total: 1000,
  returnedQuantity: 0,
  nonReturnable: false,
  isClearance: false,
  variant: soldVariant,
};

const originalSale = (over: Record<string, unknown> = {}) => ({
  id: 1,
  saleNumber: 'W-0001',
  status: 'completed',
  customerId: 9,
  createdAt: new Date(),
  items: [originalSaleItem],
  ...over,
});

const priorExchangeRow = {
  id: 7,
  returnNumber: 'RT-0007',
  type: 'exchange',
  createdAt: new Date('2026-09-05T06:00:00Z'),
};

/** Enough of a working till for a one-line ₹1000 cash sale to complete. */
function mockCheckout(orig: Record<string, unknown>, priorReturns: unknown[]) {
  prismaMock.posSession.findFirst.mockResolvedValue({
    id: 1,
    userId: 3,
    branchId: 1,
    status: 'open',
    businessDate: new Date(),
    createdAt: new Date(),
  });
  // getSetting() reads. Every key falls back to its default.
  prismaMock.setting.findUnique.mockResolvedValue(null);
  prismaMock.productVariant.findMany.mockResolvedValue([soldVariant]);
  prismaMock.inventory.findMany.mockResolvedValue([{ variantId: 5, branchId: 1, quantity: 10 }]);
  prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 5, branchId: 1, quantity: 10 });
  prismaMock.inventory.update.mockResolvedValue({});
  prismaMock.inventory.upsert.mockResolvedValue({});
  prismaMock.inventoryMovement.create.mockResolvedValue({});
  prismaMock.offer.findMany.mockResolvedValue([]);
  // The exchange preflight and the in-transaction lookup both land here.
  prismaMock.sale.findUnique.mockResolvedValue(orig);
  prismaMock.return.findMany.mockResolvedValue(priorReturns);
  prismaMock.return.create.mockResolvedValue({ id: 55, returnNumber: 'RT-0055' });
  prismaMock.saleItem.update.mockResolvedValue({});
  prismaMock.saleItem.findMany.mockResolvedValue([{ id: 10, quantity: 1, returnedQuantity: 1 }]);
  prismaMock.sale.update.mockResolvedValue({});
  prismaMock.billSequence.upsert.mockResolvedValue({ key: 'walkin', lastNumber: 2 });
  prismaMock.customer.findUnique.mockResolvedValue({
    id: 9,
    firstName: 'Sabiha',
    lastName: 'Khan',
    loyaltyPoints: 0,
    totalSpent: 0,
    visitCount: 1,
  });
  prismaMock.customer.update.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({ id: 1 });
  prismaMock.commission.findMany.mockResolvedValue([]);
  prismaMock.commission.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.sale.create.mockResolvedValue({
    id: 2,
    saleNumber: 'W-0002',
    total: 1000,
    items: [],
    payments: [],
    customer: null,
  });
}

const checkoutBody = (over: Record<string, unknown> = {}) => ({
  items: [{ barcode: '1111111111111', quantity: 1 }],
  payments: [{ method: 'cash', amount: 1000 }],
  exchange: {
    originalSaleId: 1,
    returnItems: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
  },
  ...over,
});

const PASSWORD = 'correct-horse';
const managerRow = {
  id: 2,
  email: 'manager@test.com',
  firstName: 'Farah',
  lastName: 'Sheikh',
  role: 'manager',
  branchId: 1,
  isActive: true,
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
};

/** Walk the manager through the approval and hand back the signed grant. */
async function grantForBill1(): Promise<string> {
  prismaMock.sale.findUnique.mockResolvedValue({ id: 1, saleNumber: 'W-0001', status: 'completed' });
  prismaMock.return.findMany.mockResolvedValue([priorExchangeRow]);
  prismaMock.user.findUnique.mockResolvedValue(managerRow);

  const res = await request(app)
    .post('/api/v1/sales/1/exchange-override')
    .set('Authorization', authHeader(testUsers.cashier))
    .send({ approverEmail: managerRow.email, approverPassword: PASSWORD });
  expect(res.status).toBe(200);
  jest.clearAllMocks();
  return res.body.data.grant as string;
}

const checkout = (body: Record<string, unknown>) =>
  request(app)
    .post(`${BASE}/checkout`)
    .set('Authorization', authHeader(testUsers.cashier))
    .send(body);

describe('POS checkout with an exchange', () => {
  it('carries the original bill customer onto the replacement sale', async () => {
    mockCheckout(originalSale(), []);

    const res = await checkout(checkoutBody());

    expect(res.status).toBe(201);
    expect(prismaMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: 9 }) })
    );
  });

  it('leaves the replacement a walk-in when the original had no customer', async () => {
    mockCheckout(originalSale({ customerId: null }), []);

    const res = await checkout(checkoutBody());

    expect(res.status).toBe(201);
    expect(prismaMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: null }) })
    );
  });

  it('never overrides a customer the cashier chose explicitly', async () => {
    mockCheckout(originalSale(), []);

    const res = await checkout(checkoutBody({ customerId: 4 }));

    expect(res.status).toBe(201);
    expect(prismaMock.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: 4 }) })
    );
  });

  it('stops a second exchange and names the earlier one', async () => {
    mockCheckout(originalSale(), [priorExchangeRow]);

    const res = await checkout(checkoutBody());

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('W-0001');
    expect(res.body.error).toContain('5 Sep 2026');
    expect(res.body.error).toMatch(/one exchange per bill/i);
    expect(prismaMock.sale.create).not.toHaveBeenCalled();
  });

  it('lets a manager approval through, and records who approved', async () => {
    const grant = await grantForBill1();
    mockCheckout(originalSale(), [priorExchangeRow]);

    const res = await checkout(
      checkoutBody({
        exchange: {
          originalSaleId: 1,
          returnItems: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
          overrideGrant: grant,
        },
      })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.return.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approvedBy: managerRow.id }) })
    );
    const override = prismaMock.auditLog.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.action === 'exchange.limit_overridden');
    expect(override).toBeDefined();
    expect(override.userId).toBe(managerRow.id);
    expect(override.entityType).toBe('sale');
    expect(override.entityId).toBe('1');
    expect(override.data.approverName).toBe('Farah Sheikh');
    expect(override.data.requestedByUserId).toBe(testUsers.cashier.userId);
    expect(override.data.priorExchange.dateLabel).toBe('5 Sep 2026');
  });
});

/**
 * §2.4 — a clearance-backed exchange that would hand money back is a clearance
 * refund in a swap's clothing, so it answers to the same rule: cover it with
 * goods, or have a Manager or Owner authorise the payout with the Owner PIN.
 */
describe('POS checkout: a clearance exchange that pays out', () => {
  const clearanceOriginal = () =>
    originalSale({
      items: [{ ...originalSaleItem, isClearance: true, nonReturnable: true }],
    });

  /** ₹1000 of clearance credit against a ₹400 replacement = ₹600 payout. */
  function mockCashOut() {
    mockCheckout(clearanceOriginal(), []);
    prismaMock.productVariant.findMany.mockResolvedValue([cheapVariant]);
    prismaMock.inventory.findMany.mockResolvedValue([{ variantId: 6, branchId: 1, quantity: 10 }]);
    prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 6, branchId: 1, quantity: 10 });
  }

  const cashOutBody = (over: Record<string, unknown> = {}) =>
    checkoutBody({
      items: [{ barcode: '2222222222222', quantity: 1 }],
      payments: [],
      ...over,
    });

  const clearanceAuditRow = () =>
    prismaMock.auditLog.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.action === 'refund.clearance_authorised');

  it('refuses the payout on the cashier\'s own authority', async () => {
    mockCashOut();

    const res = await checkout(cashOutBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Owner PIN/i);
    expect(prismaMock.sale.create).not.toHaveBeenCalled();
    expect(clearanceAuditRow()).toBeUndefined();
  });

  it('pays out on the Owner PIN, and records it against the exchange', async () => {
    mockCashOut();

    const res = await checkout(cashOutBody({ ownerPin: '1234' }));

    expect(res.status).toBe(201);
    const row = clearanceAuditRow();
    expect(row).toBeDefined();
    expect(row.data.via).toBe('exchange-cash-out');
    expect(row.data.paidOut).toBe(600);
    expect(row.data.clearanceCredit).toBe(1000);
    expect(row.data.authorisedBy).toBe('owner-pin');
  });

  it('refuses a wrong PIN', async () => {
    mockCashOut();

    const res = await checkout(cashOutBody({ ownerPin: '9999' }));

    expect(res.status).toBe(403);
    expect(prismaMock.sale.create).not.toHaveBeenCalled();
  });

  it('asks for nothing when the replacement covers the clearance credit', async () => {
    mockCheckout(clearanceOriginal(), []);

    const res = await checkout(checkoutBody());

    expect(res.status).toBe(201);
    expect(clearanceAuditRow()).toBeUndefined();
  });
});
