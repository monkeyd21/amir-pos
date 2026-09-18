import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

/**
 * §2.4 — refunding clearance goods, end to end.
 *
 * The shop prints NON-RETURNABLE on every clearance line and means it when a
 * cashier asks. It relents when a Manager or an Owner says so, which costs the
 * Owner PIN (§6.4). That is the whole rule: not a door, not a wall, a lock.
 *
 * What the PIN must NOT open is a line the goods themselves rule out — a
 * product flagged non-returnable, or one the cashier sold as-is. Those are
 * about the merchandise, not the price paid, and no PIN reaches them.
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

const BASE = '/api/v1/sales';
// No `ownerPin` setting row is mocked, so the PIN in force is the §6.4 default.
const OWNER_PIN = '1234';

/** A walk-in bill with one line, so no loyalty/customer mocks are needed. */
const saleWith = (item: Record<string, unknown>) => ({
  id: 1,
  branchId: 1,
  userId: 3,
  customerId: null,
  saleNumber: 'SL-CLR-001',
  status: 'completed',
  subtotal: 600,
  taxAmount: 91.53,
  total: 600,
  loyaltyPointsEarned: 0,
  loyaltyPointsRedeemed: 0,
  createdAt: new Date(),
  items: [
    {
      id: 10,
      saleId: 1,
      variantId: 5,
      quantity: 1,
      unitPrice: 600,
      taxAmount: 91.53,
      total: 600,
      returnedQuantity: 0,
      nonReturnable: false,
      isClearance: false,
      variant: {
        id: 5,
        size: '30',
        color: 'Black',
        product: { id: 1, name: 'Dress', nonReturnable: false, exchangeOnly: false },
      },
      ...item,
    },
  ],
  payments: [{ id: 1, method: 'cash', amount: 600, referenceNumber: null, status: 'completed' }],
});

/** The clearance line from the shop's own bill: charged 600 against a 1240 MRP. */
const clearanceSale = saleWith({ isClearance: true, nonReturnable: true });

function mockRefundWrites() {
  prismaMock.return.create.mockResolvedValue({
    id: 77,
    returnNumber: 'RT-TEST-077',
    originalSaleId: 1,
    type: 'return',
    status: 'completed',
    subtotal: 600,
    taxAmount: 91.53,
    total: 600,
    items: [{ id: 1, variantId: 5, quantity: 1, condition: 'resellable' }],
  });
  prismaMock.saleItem.update.mockResolvedValue({});
  prismaMock.inventory.upsert.mockResolvedValue({});
  prismaMock.inventoryMovement.create.mockResolvedValue({});
  prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.saleItem.findMany.mockResolvedValue([{ id: 10, quantity: 1, returnedQuantity: 1 }]);
  prismaMock.sale.update.mockResolvedValue({});
}

const refundBody = (extra: Record<string, unknown> = {}) => ({
  items: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
  reason: 'size_issue',
  refundSplit: [{ method: 'cash', amount: 600 }],
  ...extra,
});

const auditActions = () =>
  prismaMock.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action);

describe('§2.4 clearance refunds', () => {
  it('refuses a cashier refunding clearance goods on their own', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(clearanceSale);
    mockRefundWrites();

    const res = await request(app)
      .post(`${BASE}/1/return`)
      .set('Authorization', authHeader(testUsers.cashier))
      .send(refundBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Owner PIN/i);
    // Refused BEFORE anything is written — no return, no restock, no audit row
    // claiming an authorisation that never happened.
    expect(prismaMock.return.create).not.toHaveBeenCalled();
    expect(prismaMock.inventory.upsert).not.toHaveBeenCalled();
    expect(auditActions()).not.toContain('refund.clearance_authorised');
  });

  it('refuses a wrong PIN', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(clearanceSale);
    mockRefundWrites();

    const res = await request(app)
      .post(`${BASE}/1/return`)
      .set('Authorization', authHeader(testUsers.cashier))
      .send(refundBody({ ownerPin: '9999' }));

    expect(res.status).toBe(403);
    expect(prismaMock.return.create).not.toHaveBeenCalled();
  });

  it('refunds clearance goods on the Owner PIN, and says so in the audit trail', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(clearanceSale);
    mockRefundWrites();

    const res = await request(app)
      .post(`${BASE}/1/return`)
      .set('Authorization', authHeader(testUsers.cashier))
      .send(refundBody({ ownerPin: OWNER_PIN }));

    expect(res.status).toBe(201);
    expect(res.body.refundAmount).toBe(600);

    const row = prismaMock.auditLog.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.action === 'refund.clearance_authorised');
    expect(row).toBeDefined();
    expect(row.entityId).toBe('77');
    // The PIN is shared, so the row records that a senior agreed and who rang
    // it up — never a name it cannot know.
    expect(row.data.authorisedBy).toBe('owner-pin');
    expect(row.data.processedByUserId).toBe(testUsers.cashier.userId);
    expect(row.data.clearanceItems).toEqual([{ saleItemId: 10, productName: 'Dress' }]);
  });

  it('does not ask for a PIN on an ordinary line', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(saleWith({}));
    mockRefundWrites();

    const res = await request(app)
      .post(`${BASE}/1/return`)
      .set('Authorization', authHeader(testUsers.cashier))
      .send(refundBody());

    expect(res.status).toBe(201);
    expect(auditActions()).not.toContain('refund.clearance_authorised');
  });

  it('will not let the PIN reopen goods the product itself rules out', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(
      saleWith({
        isClearance: true,
        nonReturnable: true,
        variant: {
          id: 5,
          size: '30',
          color: 'Black',
          product: { id: 1, name: 'Dress', nonReturnable: true, exchangeOnly: false },
        },
      })
    );
    mockRefundWrites();

    const res = await request(app)
      .post(`${BASE}/1/return`)
      .set('Authorization', authHeader(testUsers.cashier))
      .send(refundBody({ ownerPin: OWNER_PIN }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-returnable/i);
    expect(prismaMock.return.create).not.toHaveBeenCalled();
  });

  it('will not let the PIN reopen a line the cashier sold as-is', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(
      saleWith({ isClearance: false, nonReturnable: true })
    );
    mockRefundWrites();

    const res = await request(app)
      .post(`${BASE}/1/return`)
      .set('Authorization', authHeader(testUsers.cashier))
      .send(refundBody({ ownerPin: OWNER_PIN }));

    expect(res.status).toBe(400);
    expect(prismaMock.return.create).not.toHaveBeenCalled();
  });
});
