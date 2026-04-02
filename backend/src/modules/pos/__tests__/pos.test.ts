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
    taxRate: 18,
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
