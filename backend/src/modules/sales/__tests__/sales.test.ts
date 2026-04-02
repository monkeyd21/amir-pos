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

const BASE = '/api/v1/sales';

const fakeSale = {
  id: 1,
  branchId: 1,
  userId: 3,
  customerId: null,
  saleNumber: 'SL-TEST-001',
  subtotal: 3000,
  taxAmount: 540,
  discountAmount: 0,
  total: 3540,
  status: 'completed',
  loyaltyPointsEarned: 0,
  loyaltyPointsRedeemed: 0,
  createdAt: new Date(),
  branch: { id: 1, name: 'Main' },
  customer: null,
  user: { id: 3, firstName: 'John', lastName: 'Doe' },
  items: [
    {
      id: 10,
      saleId: 1,
      variantId: 5,
      quantity: 2,
      unitPrice: 1500,
      discount: 0,
      taxAmount: 540,
      total: 3540,
      returnedQuantity: 0,
      variant: {
        id: 5,
        sku: 'TST-CLA-M-BLU-AB12',
        size: 'M',
        color: 'Blue',
        product: { id: 1, name: 'T-Shirt', brand: {}, category: {} },
      },
      returnItems: [],
    },
  ],
  payments: [{ id: 1, method: 'cash', amount: 3540, referenceNumber: null, status: 'completed' }],
  returns: [],
  _count: { returns: 0 },
};

describe('Sales Module', () => {
  // ─── GET / (list sales) ─────────────────────────────────────
  describe('GET / (list sales)', () => {
    it('should list sales with pagination', async () => {
      prismaMock.sale.findMany.mockResolvedValue([fakeSale]);
      prismaMock.sale.count.mockResolvedValue(1);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
    });

    it('should filter by status', async () => {
      prismaMock.sale.findMany.mockResolvedValue([]);
      prismaMock.sale.count.mockResolvedValue(0);

      const res = await request(app)
        .get(`${BASE}?status=returned`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ─── GET /:id (sale detail) ─────────────────────────────────
  describe('GET /:id (sale detail)', () => {
    it('should return sale with items, payments, returns', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(fakeSale);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.saleNumber).toBe('SL-TEST-001');
    });

    it('should return 404 for non-existent sale', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /:saleId/return (partial return) ──────────────────
  describe('POST /:saleId/return (partial return)', () => {
    it('should process a partial return', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...fakeSale,
        items: [
          {
            id: 10,
            variantId: 5,
            quantity: 2,
            unitPrice: 1500,
            taxAmount: 540,
            returnedQuantity: 0,
          },
        ],
      });

      prismaMock.return.create.mockResolvedValue({
        id: 1,
        returnNumber: 'RT-TEST-001',
        originalSaleId: 1,
        type: 'return',
        status: 'completed',
        subtotal: 1500,
        taxAmount: 270,
        total: 1770,
        items: [{ id: 1, variantId: 5, quantity: 1, condition: 'resellable' }],
      });

      prismaMock.saleItem.update.mockResolvedValue({});
      prismaMock.inventory.upsert.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      prismaMock.saleItem.findMany.mockResolvedValue([
        { id: 10, quantity: 2, returnedQuantity: 1 },
      ]);
      prismaMock.sale.update.mockResolvedValue({});

      const res = await request(app)
        .post(`${BASE}/1/return`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          items: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
          reason: 'Wrong size',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('return');
    });
  });

  // ─── POST /:saleId/return (full return) ────────────────────
  describe('POST /:saleId/return (full return)', () => {
    it('should set sale status to "returned" when all items returned', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...fakeSale,
        items: [
          {
            id: 10,
            variantId: 5,
            quantity: 2,
            unitPrice: 1500,
            taxAmount: 540,
            returnedQuantity: 0,
          },
        ],
      });

      prismaMock.return.create.mockResolvedValue({
        id: 2,
        returnNumber: 'RT-TEST-002',
        originalSaleId: 1,
        type: 'return',
        status: 'completed',
        subtotal: 3000,
        taxAmount: 540,
        total: 3540,
        items: [{ id: 1, variantId: 5, quantity: 2, condition: 'resellable' }],
      });

      prismaMock.saleItem.update.mockResolvedValue({});
      prismaMock.inventory.upsert.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      prismaMock.saleItem.findMany.mockResolvedValue([
        { id: 10, quantity: 2, returnedQuantity: 2 },
      ]);
      prismaMock.sale.update.mockResolvedValue({});

      const res = await request(app)
        .post(`${BASE}/1/return`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({
          items: [{ saleItemId: 10, quantity: 2, condition: 'resellable' }],
          reason: 'Customer changed mind',
        });

      expect(res.status).toBe(201);
      expect(prismaMock.sale.update).toHaveBeenCalled();
    });
  });

  // ─── Return restocks inventory ──────────────────────────────
  describe('Return restocks inventory', () => {
    it('should restock inventory for resellable items', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...fakeSale,
        items: [
          {
            id: 10,
            variantId: 5,
            quantity: 2,
            unitPrice: 1500,
            taxAmount: 540,
            returnedQuantity: 0,
          },
        ],
      });

      prismaMock.return.create.mockResolvedValue({
        id: 3,
        returnNumber: 'RT-TEST-003',
        originalSaleId: 1,
        type: 'return',
        status: 'completed',
        subtotal: 1500,
        taxAmount: 270,
        total: 1770,
        items: [{ id: 1, variantId: 5, quantity: 1, condition: 'resellable' }],
      });

      prismaMock.saleItem.update.mockResolvedValue({});
      prismaMock.inventory.upsert.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});
      prismaMock.saleItem.findMany.mockResolvedValue([
        { id: 10, quantity: 2, returnedQuantity: 1 },
      ]);
      prismaMock.sale.update.mockResolvedValue({});

      await request(app)
        .post(`${BASE}/1/return`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          items: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
          reason: 'Size exchange',
        });

      // Verify inventory was restocked
      expect(prismaMock.inventory.upsert).toHaveBeenCalled();
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalled();
    });

    it('should NOT restock inventory for damaged items', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...fakeSale,
        items: [
          {
            id: 10,
            variantId: 5,
            quantity: 2,
            unitPrice: 1500,
            taxAmount: 540,
            returnedQuantity: 0,
          },
        ],
      });

      prismaMock.return.create.mockResolvedValue({
        id: 4,
        returnNumber: 'RT-TEST-004',
        originalSaleId: 1,
        type: 'return',
        status: 'completed',
        subtotal: 1500,
        taxAmount: 270,
        total: 1770,
        items: [{ id: 1, variantId: 5, quantity: 1, condition: 'damaged' }],
      });

      prismaMock.saleItem.update.mockResolvedValue({});
      prismaMock.saleItem.findMany.mockResolvedValue([
        { id: 10, quantity: 2, returnedQuantity: 1 },
      ]);
      prismaMock.sale.update.mockResolvedValue({});

      await request(app)
        .post(`${BASE}/1/return`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          items: [{ saleItemId: 10, quantity: 1, condition: 'damaged' }],
          reason: 'Defective',
        });

      // inventory.upsert should NOT have been called (damaged items don't restock)
      expect(prismaMock.inventory.upsert).not.toHaveBeenCalled();
    });
  });

  // ─── POST /:saleId/exchange ─────────────────────────────────
  describe('POST /:saleId/exchange', () => {
    it('should process an exchange', async () => {
      prismaMock.sale.findUnique.mockResolvedValue({
        ...fakeSale,
        items: [
          {
            id: 10,
            variantId: 5,
            quantity: 2,
            unitPrice: 1500,
            taxAmount: 540,
            returnedQuantity: 0,
          },
        ],
      });

      const newVariant = {
        id: 20,
        barcode: '2009876543210',
        size: 'L',
        color: 'Red',
        priceOverride: null,
        costOverride: null,
        isActive: true,
        product: { id: 2, name: 'Polo', basePrice: 2000, costPrice: 1000, taxRate: 18 },
      };
      prismaMock.productVariant.findMany.mockResolvedValue([newVariant]);
      prismaMock.inventory.findUnique.mockResolvedValue({ quantity: 10 });

      prismaMock.return.create.mockResolvedValue({
        id: 5,
        returnNumber: 'RT-TEST-005',
        type: 'exchange',
        status: 'completed',
        items: [],
      });

      prismaMock.saleItem.update.mockResolvedValue({});
      prismaMock.inventory.upsert.mockResolvedValue({});
      prismaMock.inventory.update.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});
      prismaMock.saleItem.findMany.mockResolvedValue([
        { id: 10, quantity: 2, returnedQuantity: 1 },
      ]);
      prismaMock.sale.update.mockResolvedValue({});

      const res = await request(app)
        .post(`${BASE}/1/exchange`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          returnItems: [{ saleItemId: 10, quantity: 1, condition: 'resellable' }],
          newItems: [{ barcode: '2009876543210', quantity: 1 }],
          reason: 'Size swap',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('priceDifference');
    });

    it('should return 404 for non-existent sale', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/999/exchange`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          returnItems: [{ saleItemId: 1, quantity: 1, condition: 'resellable' }],
          newItems: [{ barcode: '123', quantity: 1 }],
        });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /:id with sale number lookup ─────────────────────────
  describe('GET /:id (sale number lookup)', () => {
    it('should return a sale when looked up by sale number', async () => {
      prismaMock.sale.findFirst.mockResolvedValue(fakeSale);

      const res = await request(app)
        .get(`${BASE}/SL-TEST-001`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.saleNumber).toBe('SL-TEST-001');
    });

    it('should return 404 for a non-existent sale number', async () => {
      prismaMock.sale.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/SL-NONEXIST-999`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(404);
    });

    it('should still work with a numeric id', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(fakeSale);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.saleNumber).toBe('SL-TEST-001');
    });
  });
});
