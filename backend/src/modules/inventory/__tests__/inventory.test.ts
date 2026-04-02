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

const BASE = '/api/v1/inventory';

describe('Inventory Module', () => {
  // ─── POST /adjust (stock adjustment increase) ──────────────
  describe('POST /adjust (stock adjustment)', () => {
    it('should increase stock', async () => {
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 10,
      });
      prismaMock.inventory.upsert.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 15,
      });
      prismaMock.inventoryMovement.create.mockResolvedValue({
        id: 1,
        variantId: 1,
        branchId: 1,
        type: 'adjustment',
        quantity: 5,
        notes: 'Recount',
      });

      const res = await request(app)
        .post(`${BASE}/adjust`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ variantId: 1, branchId: 1, quantity: 5, reason: 'Recount' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.inventory.quantity).toBe(15);
      expect(res.body.data.movement.type).toBe('adjustment');
    });

    it('should decrease stock', async () => {
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 10,
      });
      prismaMock.inventory.upsert.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 7,
      });
      prismaMock.inventoryMovement.create.mockResolvedValue({
        id: 2,
        variantId: 1,
        branchId: 1,
        type: 'adjustment',
        quantity: -3,
        notes: 'Damaged items removed',
      });

      const res = await request(app)
        .post(`${BASE}/adjust`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ variantId: 1, branchId: 1, quantity: -3, reason: 'Damaged items removed' });

      expect(res.status).toBe(201);
      expect(res.body.data.inventory.quantity).toBe(7);
    });

    it('should fail when adjustment would make stock negative', async () => {
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 3,
      });

      const res = await request(app)
        .post(`${BASE}/adjust`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ variantId: 1, branchId: 1, quantity: -10, reason: 'Over-reduce' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/insufficient stock/i);
    });

    it('should reject zero quantity adjustment', async () => {
      const res = await request(app)
        .post(`${BASE}/adjust`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ variantId: 1, branchId: 1, quantity: 0, reason: 'No change' });

      expect(res.status).toBe(400);
    });

    it('should reject if cashier attempts stock adjustment', async () => {
      const res = await request(app)
        .post(`${BASE}/adjust`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ variantId: 1, branchId: 1, quantity: 5, reason: 'Test' });

      expect(res.status).toBe(403);
    });
  });

  // ─── POST /transfer (create transfer) ──────────────────────
  describe('POST /transfer (create transfer)', () => {
    it('should create a stock transfer', async () => {
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 50,
      });

      const transfer = {
        id: 1,
        fromBranchId: 1,
        toBranchId: 2,
        status: 'pending',
        createdBy: 2,
        items: [{ id: 1, variantId: 1, quantitySent: 10, variant: {} }],
        fromBranch: { id: 1, name: 'Branch A' },
        toBranch: { id: 2, name: 'Branch B' },
      };
      prismaMock.stockTransfer.create.mockResolvedValue(transfer);

      const res = await request(app)
        .post(`${BASE}/transfer`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({
          fromBranchId: 1,
          toBranchId: 2,
          items: [{ variantId: 1, quantity: 10 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.items).toHaveLength(1);
    });

    it('should reject transfer to the same branch', async () => {
      const res = await request(app)
        .post(`${BASE}/transfer`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({
          fromBranchId: 1,
          toBranchId: 1,
          items: [{ variantId: 1, quantity: 10 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/same branch/i);
    });

    it('should reject transfer with insufficient stock', async () => {
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 2,
      });

      const res = await request(app)
        .post(`${BASE}/transfer`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({
          fromBranchId: 1,
          toBranchId: 2,
          items: [{ variantId: 1, quantity: 100 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/insufficient stock/i);
    });
  });

  // ─── PUT /transfer/:id/approve ─────────────────────────────
  describe('PUT /transfer/:id/approve (deducts stock)', () => {
    it('should approve transfer and deduct stock from source', async () => {
      prismaMock.stockTransfer.findUnique.mockResolvedValue({
        id: 1,
        fromBranchId: 1,
        toBranchId: 2,
        status: 'pending',
        items: [{ id: 1, variantId: 1, quantitySent: 10 }],
      });
      prismaMock.inventory.findUnique.mockResolvedValue({
        variantId: 1,
        branchId: 1,
        quantity: 50,
      });
      prismaMock.inventory.update.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});
      prismaMock.stockTransfer.update.mockResolvedValue({
        id: 1,
        status: 'in_transit',
        approvedBy: 2,
        items: [{ id: 1, variantId: 1, quantitySent: 10, variant: {} }],
        fromBranch: {},
        toBranch: {},
      });

      const res = await request(app)
        .put(`${BASE}/transfer/1/approve`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in_transit');

      // Verify stock was decremented
      expect(prismaMock.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantity: { decrement: 10 } },
        })
      );

      // Verify transfer_out movement created
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'transfer_out',
            quantity: -10,
          }),
        })
      );
    });

    it('should reject approving a non-pending transfer', async () => {
      prismaMock.stockTransfer.findUnique.mockResolvedValue({
        id: 1,
        status: 'in_transit',
        items: [],
      });

      const res = await request(app)
        .put(`${BASE}/transfer/1/approve`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already/i);
    });
  });

  // ─── PUT /transfer/:id/receive ─────────────────────────────
  describe('PUT /transfer/:id/receive (adds stock)', () => {
    it('should receive transfer and add stock to destination', async () => {
      prismaMock.stockTransfer.findUnique.mockResolvedValue({
        id: 1,
        fromBranchId: 1,
        toBranchId: 2,
        status: 'in_transit',
        items: [{ id: 1, variantId: 1, quantitySent: 10 }],
      });
      prismaMock.inventory.upsert.mockResolvedValue({});
      prismaMock.stockTransferItem.update.mockResolvedValue({});
      prismaMock.inventoryMovement.create.mockResolvedValue({});
      prismaMock.stockTransfer.update.mockResolvedValue({
        id: 1,
        status: 'completed',
        completedAt: new Date(),
        items: [{ id: 1, variantId: 1, quantitySent: 10, quantityReceived: 10, variant: {} }],
        fromBranch: {},
        toBranch: {},
      });

      const res = await request(app)
        .put(`${BASE}/transfer/1/receive`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');

      // Verify stock was added to destination
      expect(prismaMock.inventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { quantity: { increment: 10 } },
        })
      );

      // Verify transfer_in movement
      expect(prismaMock.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'transfer_in',
            quantity: 10,
          }),
        })
      );
    });

    it('should reject receiving a non-in_transit transfer', async () => {
      prismaMock.stockTransfer.findUnique.mockResolvedValue({
        id: 1,
        status: 'pending',
        items: [],
      });

      const res = await request(app)
        .put(`${BASE}/transfer/1/receive`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/in_transit/i);
    });
  });

  // ─── Movement audit trail ──────────────────────────────────
  describe('GET /movements (audit trail)', () => {
    it('should list inventory movements', async () => {
      prismaMock.inventoryMovement.findMany.mockResolvedValue([
        {
          id: 1,
          variantId: 1,
          branchId: 1,
          type: 'adjustment',
          quantity: 5,
          createdAt: new Date(),
          variant: { product: { name: 'Test' } },
          branch: { name: 'Main' },
          user: { id: 2, firstName: 'A', lastName: 'B' },
        },
      ]);
      prismaMock.inventoryMovement.count.mockResolvedValue(1);

      const res = await request(app)
        .get(`${BASE}/movements`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe('adjustment');
      expect(res.body.meta.total).toBe(1);
    });
  });
});
