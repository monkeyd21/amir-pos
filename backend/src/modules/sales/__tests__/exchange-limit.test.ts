import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

/**
 * §0 one exchange per bill, end to end.
 *
 * The shop calls this a general policy, so it warns rather than blocks: a
 * manager or an owner can let a second swap through, and the approval is
 * recorded against the bill. A cashier cannot wave it through alone.
 *
 * The line between a refund and an exchange is `Return.type`. A bill that was
 * merely refunded against still has its exchange, and must go through with no
 * prompt and no extra click.
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

const PASSWORD = 'correct-horse';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

const managerRow = {
  id: 2,
  email: 'manager@test.com',
  firstName: 'Farah',
  lastName: 'Sheikh',
  role: 'manager',
  branchId: 1,
  isActive: true,
  passwordHash,
};

const cashierRow = {
  id: 3,
  email: 'cashier@test.com',
  firstName: 'Raju',
  lastName: 'Verma',
  role: 'cashier',
  branchId: 1,
  isActive: true,
  passwordHash,
};

const saleWithCustomer = {
  id: 1,
  branchId: 1,
  userId: 3,
  customerId: 9,
  saleNumber: 'W-0001',
  status: 'completed',
  total: 3540,
  createdAt: new Date(),
  items: [
    { id: 10, variantId: 5, quantity: 2, unitPrice: 1500, taxAmount: 540, total: 3000, returnedQuantity: 0 },
  ],
};

const walkInSale = { ...saleWithCustomer, id: 2, saleNumber: 'W-0002', customerId: null };

const newVariant = {
  id: 20,
  barcode: '2009876543210',
  size: 'L',
  color: 'Red',
  priceOverride: null,
  costOverride: null,
  isActive: true,
  product: { id: 2, name: 'Polo', basePrice: 2000, costPrice: 1000, cgstRate: 9, sgstRate: 9, priceIncludesTax: true },
};

const priorExchangeRow = {
  id: 7,
  returnNumber: 'RT-0007',
  type: 'exchange',
  createdAt: new Date('2026-09-05T06:00:00Z'),
};

const priorRefundRow = {
  id: 6,
  returnNumber: 'RT-0006',
  type: 'return',
  createdAt: new Date('2026-09-04T06:00:00Z'),
};

/** Everything the swap itself needs, so only the policy is under test. */
function mockExchangeMachinery(sale: Record<string, unknown> = saleWithCustomer) {
  prismaMock.sale.findUnique.mockResolvedValue(sale);
  prismaMock.productVariant.findMany.mockResolvedValue([newVariant]);
  prismaMock.inventory.findUnique.mockResolvedValue({ quantity: 10 });
  prismaMock.return.create.mockResolvedValue({
    id: 55,
    returnNumber: 'RT-0055',
    type: 'exchange',
    status: 'completed',
    items: [],
  });
  prismaMock.saleItem.update.mockResolvedValue({});
  prismaMock.inventory.upsert.mockResolvedValue({});
  prismaMock.inventory.update.mockResolvedValue({});
  prismaMock.inventoryMovement.create.mockResolvedValue({});
  prismaMock.saleItem.findMany.mockResolvedValue([{ id: 10, quantity: 2, returnedQuantity: 1 }]);
  prismaMock.sale.update.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({ id: 1 });
}

const exchangeBody = (over: Record<string, unknown> = {}) => ({
  returnItems: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
  newItems: [{ barcode: '2009876543210', quantity: 1 }],
  reason: 'Size swap',
  ...over,
});

const postExchange = (saleId: number, body: Record<string, unknown>, user = testUsers.cashier) =>
  request(app).post(`${BASE}/${saleId}/exchange`).set('Authorization', authHeader(user)).send(body);

const postOverride = (saleId: number, body: Record<string, unknown>, user = testUsers.cashier) =>
  request(app)
    .post(`${BASE}/${saleId}/exchange-override`)
    .set('Authorization', authHeader(user))
    .send(body);

/** Walk the manager through the approval and hand back the signed grant. */
async function grantFor(saleId: number): Promise<string> {
  prismaMock.sale.findUnique.mockResolvedValue({
    id: saleId,
    saleNumber: 'W-0001',
    status: 'completed',
  });
  prismaMock.return.findMany.mockResolvedValue([priorExchangeRow]);
  prismaMock.user.findUnique.mockResolvedValue(managerRow);

  const res = await postOverride(saleId, {
    approverEmail: managerRow.email,
    approverPassword: PASSWORD,
  });
  expect(res.status).toBe(200);
  jest.clearAllMocks();
  return res.body.data.grant as string;
}

// The exchange itself (first one allowed, second refused, the override
// honoured, the replacement billed) is covered against a real database in
// src/__integration__/exchange-billing.test.ts. These keep the approval and
// the bill-read checks, which need no checkout.
describe('one exchange per bill', () => {
  describe('a second exchange is caught', () => {
    it('reports the earlier exchange date on the bill read, before anything is picked', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...saleWithCustomer,
        customer: { id: 9, firstName: 'Sabiha', lastName: 'Khan', phone: '9876500000' },
        returns: [priorRefundRow, priorExchangeRow],
        payments: [],
      });

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.priorExchange).toMatchObject({
        returnNumber: 'RT-0007',
        dateLabel: '5 Sep 2026',
      });
      // Part 1: the customer travels with the bill, so the exchange screen can
      // show who is being served without the cashier looking them up.
      expect(res.body.data.customer.firstName).toBe('Sabiha');
    });

    it('leaves priorExchange null on a bill that was only refunded against', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...walkInSale,
        customer: null,
        returns: [priorRefundRow],
        payments: [],
      });

      const res = await request(app)
        .get(`${BASE}/2`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.priorExchange).toBeNull();
      expect(res.body.data.customer).toBeNull();
    });
  });

  describe('the manager override', () => {
    it('refuses a cashier trying to approve on their own', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        id: 1,
        saleNumber: 'W-0001',
        status: 'completed',
      });
      prismaMock.return.findMany.mockResolvedValue([priorExchangeRow]);
      prismaMock.user.findUnique.mockResolvedValue(cashierRow);

      const res = await postOverride(1, {
        approverEmail: cashierRow.email,
        approverPassword: PASSWORD,
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only an owner or a manager/i);
    });

    it('refuses a manager who gets their password wrong', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        id: 1,
        saleNumber: 'W-0001',
        status: 'completed',
      });
      prismaMock.return.findMany.mockResolvedValue([priorExchangeRow]);
      prismaMock.user.findUnique.mockResolvedValue(managerRow);

      const res = await postOverride(1, {
        approverEmail: managerRow.email,
        approverPassword: 'not-the-password',
      });

      expect(res.status).toBe(403);
    });

    it('will not approve a bill that has not been exchanged yet', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        id: 1,
        saleNumber: 'W-0001',
        status: 'completed',
      });
      prismaMock.return.findMany.mockResolvedValue([priorRefundRow]);

      const res = await postOverride(1, {
        approverEmail: managerRow.email,
        approverPassword: PASSWORD,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not been exchanged/i);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('will not let an approval for one bill be spent on another', async () => {
      const grant = await grantFor(1);

      mockExchangeMachinery({ ...saleWithCustomer, id: 2, saleNumber: 'W-0002' });
      prismaMock.return.findMany.mockResolvedValue([priorExchangeRow]);

      const res = await postExchange(2, exchangeBody({ overrideGrant: grant }));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/different bill/i);
      expect(prismaMock.return.create).not.toHaveBeenCalled();
    });

    it('rejects a made-up grant', async () => {
      mockExchangeMachinery();
      prismaMock.return.findMany.mockResolvedValue([priorExchangeRow]);

      const res = await postExchange(1, exchangeBody({ overrideGrant: 'not.a.token' }));

      expect(res.status).toBe(403);
      expect(prismaMock.return.create).not.toHaveBeenCalled();
    });
  });
});
