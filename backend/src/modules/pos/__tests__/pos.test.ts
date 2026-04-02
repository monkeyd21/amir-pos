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

describe('POS Module', () => {
  // ─── POST /sessions/open ────────────────────────────────────
  describe('POST /sessions/open', () => {
    it('should open a new POS session', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue(null); // no existing open session
      prismaMock.posSession.create.mockResolvedValue({
        id: 1,
        branchId: 1,
        userId: 3,
        openingAmount: 5000,
        status: 'open',
        openedAt: new Date(),
        notes: null,
      });

      const res = await request(app)
        .post(`${BASE}/sessions/open`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ openingAmount: 5000 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.openingAmount).toBe(5000);
      expect(res.body.data.status).toBe('open');
    });

    it('should reject opening a second session', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue({
        id: 1,
        status: 'open',
      });

      const res = await request(app)
        .post(`${BASE}/sessions/open`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ openingAmount: 5000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already have an open session/i);
    });

    it('should reject negative opening amount', async () => {
      const res = await request(app)
        .post(`${BASE}/sessions/open`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ openingAmount: -100 });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /checkout ─────────────────────────────────────────
  describe('POST /checkout', () => {
    const checkoutPayload = {
      items: [{ barcode: '2001234567890', quantity: 2 }],
      payments: [{ method: 'cash', amount: 3540 }],
    };

    const mockVariant = {
      id: 10,
      barcode: '2001234567890',
      size: 'M',
      color: 'Blue',
      priceOverride: null,
      costOverride: null,
      isActive: true,
      product: {
        id: 1,
        name: 'T-Shirt',
        basePrice: 1500,
        costPrice: 800,
        taxRate: 18,
      },
    };

    it('should complete a checkout with valid items and sufficient stock', async () => {
      // $transaction will invoke callback with prismaMock
      prismaMock.posSession.findFirst.mockResolvedValue({ id: 1, status: 'open', openedAt: new Date() });
      prismaMock.productVariant.findMany.mockResolvedValue([mockVariant]);
      prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 10, branchId: 1, quantity: 50 });

      const sale = {
        id: 1,
        saleNumber: 'SL-TEST-001',
        subtotal: 3000,
        taxAmount: 540,
        discountAmount: 0,
        total: 3540,
        items: [],
        payments: [],
        customer: null,
        loyaltyPointsEarned: 0,
      };
      prismaMock.sale.create.mockResolvedValue(sale);
      prismaMock.inventory.update.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const res = await request(app)
        .post(`${BASE}/checkout`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send(checkoutPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.saleNumber).toBe('SL-TEST-001');
    });

    it('should fail checkout with insufficient stock', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue({ id: 1, status: 'open', openedAt: new Date() });
      prismaMock.productVariant.findMany.mockResolvedValue([mockVariant]);
      prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 10, branchId: 1, quantity: 1 }); // only 1 available, need 2

      const res = await request(app)
        .post(`${BASE}/checkout`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send(checkoutPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/insufficient stock/i);
    });

    it('should succeed with split payment (cash + card)', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue({ id: 1, status: 'open', openedAt: new Date() });
      prismaMock.productVariant.findMany.mockResolvedValue([mockVariant]);
      prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 10, branchId: 1, quantity: 50 });

      const sale = {
        id: 2,
        saleNumber: 'SL-TEST-002',
        subtotal: 3000,
        taxAmount: 540,
        discountAmount: 0,
        total: 3540,
        items: [],
        payments: [],
        customer: null,
        loyaltyPointsEarned: 0,
      };
      prismaMock.sale.create.mockResolvedValue(sale);
      prismaMock.inventory.update.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});

      const res = await request(app)
        .post(`${BASE}/checkout`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          items: [{ barcode: '2001234567890', quantity: 2 }],
          payments: [
            { method: 'cash', amount: 2000 },
            { method: 'card', amount: 1540, referenceNumber: 'CC-123' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should fail if no open POS session', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/checkout`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send(checkoutPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no open pos session/i);
    });

    it('should fail if payment is less than total', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue({ id: 1, status: 'open', openedAt: new Date() });
      prismaMock.productVariant.findMany.mockResolvedValue([mockVariant]);
      prismaMock.inventory.findUnique.mockResolvedValue({ variantId: 10, branchId: 1, quantity: 50 });

      const res = await request(app)
        .post(`${BASE}/checkout`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          items: [{ barcode: '2001234567890', quantity: 2 }],
          payments: [{ method: 'cash', amount: 100 }], // way short
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/payment shortfall/i);
    });

    it('should reject checkout without authentication', async () => {
      const res = await request(app)
        .post(`${BASE}/checkout`)
        .send(checkoutPayload);

      expect(res.status).toBe(401);
    });
  });

  // ─── Hold and resume ────────────────────────────────────────
  describe('POST /hold and POST /held/:id/resume', () => {
    it('should hold a cart', async () => {
      prismaMock.heldTransaction.create.mockResolvedValue({
        id: 1,
        branchId: 1,
        userId: 3,
        cartData: { items: [{ barcode: '123', qty: 1 }] },
        customerId: null,
        customer: null,
        notes: 'customer stepped out',
        createdAt: new Date(),
      });

      const res = await request(app)
        .post(`${BASE}/hold`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          cartData: { items: [{ barcode: '123', qty: 1 }] },
          notes: 'customer stepped out',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cartData.items).toHaveLength(1);
    });

    it('should resume a held cart and delete it', async () => {
      const heldData = {
        id: 1,
        cartData: { items: [{ barcode: '123', qty: 1 }] },
        customer: null,
        notes: null,
      };
      prismaMock.heldTransaction.findUnique.mockResolvedValue(heldData);
      prismaMock.heldTransaction.delete.mockResolvedValue(heldData);

      const res = await request(app)
        .post(`${BASE}/held/1/resume`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.cartData.items).toHaveLength(1);
      expect(prismaMock.heldTransaction.delete).toHaveBeenCalled();
    });

    it('should return 404 when resuming a non-existent held transaction', async () => {
      prismaMock.heldTransaction.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/held/999/resume`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /sessions/close ──────────────────────────────────
  describe('POST /sessions/close', () => {
    it('should close session and calculate expected amount', async () => {
      const session = {
        id: 1,
        userId: 3,
        openingAmount: 5000,
        status: 'open',
        openedAt: new Date('2025-01-01'),
        notes: null,
      };

      // First call: closeSession->findFirst, Second call: finalizeCloseSession calls closeSession again
      prismaMock.posSession.findFirst.mockResolvedValue(session);
      prismaMock.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10000 } })  // cash payments
        .mockResolvedValueOnce({ _sum: { amount: 500 } })    // cash refunds
        .mockResolvedValueOnce({ _sum: { amount: 10000 } })  // 2nd call in finalize
        .mockResolvedValueOnce({ _sum: { amount: 500 } });

      const updatedSession = {
        ...session,
        closingAmount: 14500,
        expectedAmount: 14500, // 5000 + 10000 - 500
        status: 'closed',
        closedAt: new Date(),
      };
      prismaMock.posSession.update.mockResolvedValue(updatedSession);

      const res = await request(app)
        .post(`${BASE}/sessions/close`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ closingAmount: 14500 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('closed');
    });

    it('should return 404 if no open session exists', async () => {
      prismaMock.posSession.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/sessions/close`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ closingAmount: 5000 });

      expect(res.status).toBe(404);
    });
  });
});
