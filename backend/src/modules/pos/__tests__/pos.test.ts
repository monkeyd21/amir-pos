import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

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

const fakeVariant = {
  id: 5,
  barcode: '1234567890123',
  sku: 'TST-LEV-M-BLU-AB12',
  size: 'M',
  color: 'Blue',
  priceOverride: null,
  costOverride: null,
  isActive: true,
  product: {
    id: 1,
    name: 'Levi Jeans',
    basePrice: 2500,
    costPrice: 1200,
    cgstRate: 9,
    sgstRate: 9,
    priceIncludesTax: true,
    hsnCode: '6203',
    brand: { id: 1, name: 'Levi' },
    category: { id: 1, name: 'Jeans' },
  },
};

describe('POS Module', () => {
  // ─── GET /products/search (search products) ──────────────────
  describe('GET /products/search', () => {
    it('should return matching products for a search query', async () => {
      prismaMock.productVariant.findMany.mockResolvedValue([fakeVariant]);
      prismaMock.inventory.findMany.mockResolvedValue([
        { variantId: 5, branchId: 1, quantity: 10 },
      ]);

      const res = await request(app)
        .get(`${BASE}/products/search?q=Levi`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].productName).toBe('Levi Jeans');
      expect(res.body.data[0].stock).toBe(10);
    });

    it('should return empty array when no products match', async () => {
      prismaMock.productVariant.findMany.mockResolvedValue([]);
      prismaMock.inventory.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get(`${BASE}/products/search?q=xyz`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  // ─── GET /sessions/current (current session) ─────────────────
  describe('GET /sessions/current', () => {
    it('should return null when no open session exists', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/sessions/current`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('should return the open session when one exists', async () => {
      const fakeSession = {
        id: 1,
        userId: 3,
        branchId: 1,
        openingAmount: 5000,
        status: 'open',
        openedAt: new Date(),
        branch: { id: 1, name: 'Main' },
      };
      prismaMock.posSession.findFirst.mockResolvedValue(fakeSession);

      const res = await request(app)
        .get(`${BASE}/sessions/current`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.status).toBe('open');
    });
  });

  // ─── GET /lookup/:barcode (barcode lookup) ───────────────────
  describe('GET /lookup/:barcode', () => {
    it('should return product info for a valid barcode', async () => {
      prismaMock.productVariant.findFirst.mockResolvedValue(fakeVariant);
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 5,
        branchId: 1,
        quantity: 15,
      });

      const res = await request(app)
        .get(`${BASE}/lookup/1234567890123`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.barcode).toBe('1234567890123');
      expect(res.body.data.productName).toBe('Levi Jeans');
      expect(res.body.data.price).toBe(2500);
      expect(res.body.data.stock).toBe(15);
    });

    it('should return 404 for an unknown barcode', async () => {
      prismaMock.productVariant.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/lookup/0000000000000`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });
});

// ─── §8.1a EOD cash: money paid OUT of the till ──────────────────────────────
// Cash handed over the counter for rent or a wage leaves the drawer exactly as
// a refund does. Before this was wired, every cash payout showed up at close as
// an unexplained shortfall.
describe('EOD expected cash — cash payouts for payables', () => {
  const openedAt = new Date('2026-08-28T04:00:00.000Z');

  const arrangeSession = (cashPayouts: Array<{ amount: string }>) => {
    prismaMock.posSession.findFirst.mockResolvedValue({
      id: 9,
      userId: testUsers.owner.userId,
      branchId: 1,
      status: 'open',
      openingAmount: '2000',
      openedAt,
    });
    prismaMock.payment.groupBy.mockResolvedValue([
      { method: 'cash', _sum: { amount: '5000' } },
    ]);
    prismaMock.return.findMany.mockResolvedValue([]);
    prismaMock.payablePayment.findMany.mockResolvedValue(cashPayouts);
  };

  it('subtracts cash payables paid from the drawer', async () => {
    // Opening 2,000 + cash sales 5,000 = 7,000 in the drawer, less 1,500 of
    // rent paid out in cash → 5,500 expected.
    arrangeSession([{ amount: '1200' }, { amount: '300' }]);

    const { posService } = await import('../service');
    const result = await posService.closeSession(testUsers.owner.userId);

    expect(result.expectedAmount).toBe(7000);
    expect(result.cashExpenses).toBe(1500);
  });

  it('reports zero when nothing was paid out in cash', async () => {
    arrangeSession([]);

    const { posService } = await import('../service');
    const result = await posService.closeSession(testUsers.owner.userId);

    expect(result.cashExpenses).toBe(0);
    expect(result.expectedAmount).toBe(7000);
  });

  it('only counts this till — tagged to the session, or untagged at the branch', async () => {
    arrangeSession([]);

    const { posService } = await import('../service');
    await posService.closeSession(testUsers.owner.userId);

    const where = prismaMock.payablePayment.findMany.mock.calls[0][0].where;
    expect(where.method).toBe('cash');
    expect(where.OR).toEqual([
      { sessionId: 9 },
      { sessionId: null, payable: { branchId: 1 } },
    ]);
    // A voided entry is not money that left the drawer.
    expect(where.payable).toEqual({ status: { not: 'void' } });
  });
});
