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

const BASE = '/api/v1/products';

const fakeBrand = { id: 1, name: 'TestBrand', slug: 'testbrand' };
const fakeCategory = { id: 1, name: 'T-Shirts', slug: 't-shirts' };

const fakeProduct = {
  id: 1,
  name: 'Classic Polo',
  slug: 'classic-polo',
  brandId: 1,
  categoryId: 1,
  basePrice: 1500,
  costPrice: 800,
  taxRate: 18,
  description: null,
  isActive: true,
  createdAt: new Date(),
  brand: fakeBrand,
  category: fakeCategory,
  variants: [],
};

describe('Products Module', () => {
  // ─── POST / (create product) ────────────────────────────────
  describe('POST / (create product)', () => {
    it('should create a product (owner)', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null); // no slug collision
      prismaMock.brand.findUnique.mockResolvedValue(fakeBrand);
      prismaMock.category.findUnique.mockResolvedValue(fakeCategory);
      prismaMock.product.create.mockResolvedValue(fakeProduct);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          name: 'Classic Polo',
          brandId: 1,
          categoryId: 1,
          basePrice: 1500,
          costPrice: 800,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Classic Polo');
    });

    it('should allow a duplicate product name and create a new article with a suffixed slug (§req 10)', async () => {
      // Base slug 'classic-polo' is taken; the next candidate 'classic-polo-2' is free.
      prismaMock.product.findUnique
        .mockResolvedValueOnce(fakeProduct) // slug collision on 'classic-polo'
        .mockResolvedValueOnce(null); //       'classic-polo-2' is free
      prismaMock.brand.findUnique.mockResolvedValue(fakeBrand);
      prismaMock.category.findUnique.mockResolvedValue(fakeCategory);
      prismaMock.product.create.mockResolvedValue(fakeProduct);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          name: 'Classic Polo',
          brandId: 1,
          categoryId: 1,
          basePrice: 1500,
          costPrice: 800,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      // A new, separate product record was created with the de-duplicated slug.
      expect(prismaMock.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Classic Polo', slug: 'classic-polo-2' }),
        })
      );
    });

    it('should return 404 if brand does not exist', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);
      prismaMock.brand.findUnique.mockResolvedValue(null);
      prismaMock.category.findUnique.mockResolvedValue(fakeCategory);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          name: 'New Shirt',
          brandId: 999,
          categoryId: 1,
          basePrice: 1500,
          costPrice: 800,
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/brand not found/i);
    });

    it('should reject if cashier tries to create a product (authorization)', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          name: 'Test',
          brandId: 1,
          categoryId: 1,
          basePrice: 100,
          costPrice: 50,
        });

      expect(res.status).toBe(403);
    });

    it('should return 401 without token', async () => {
      const res = await request(app).post(BASE).send({
        name: 'Test',
        brandId: 1,
        categoryId: 1,
        basePrice: 100,
        costPrice: 50,
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── GET / (list products with pagination) ───────────────────
  describe('GET / (list products)', () => {
    it('should list products with default pagination', async () => {
      prismaMock.product.findMany.mockResolvedValue([fakeProduct]);
      prismaMock.product.count.mockResolvedValue(1);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('page', 1);
      expect(res.body.meta).toHaveProperty('limit', 20);
      expect(res.body.meta).toHaveProperty('total', 1);
      expect(res.body.meta).toHaveProperty('totalPages', 1);
    });

    it('should pass pagination parameters correctly', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      prismaMock.product.count.mockResolvedValue(0);

      const res = await request(app)
        .get(`${BASE}?page=2&limit=5`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.limit).toBe(5);
    });
  });

  // ─── GET / stock column (branch-scoped, one query per page) ──
  describe('GET / (in-stock quantity per product)', () => {
    // A product whose variants live in more than one branch: only branch 1,
    // the branch in context, may be counted.
    const multiVariant = {
      ...fakeProduct,
      id: 10,
      name: 'Kurta Set',
      variants: [{ id: 101 }, { id: 102 }, { id: 103 }],
    };
    // Every variant sold out at branch 1, so the row must read 0, not blank.
    const soldOut = {
      ...fakeProduct,
      id: 20,
      name: 'Sold Out Frock',
      variants: [{ id: 201 }],
    };
    // No variants at all, so the database must not be touched for stock.
    const noVariants = { ...fakeProduct, id: 30, name: 'Bare Product', variants: [] };

    // Stands in for the inventory table: one row per (variantId, branchId).
    const inventoryRows = [
      { variantId: 101, branchId: 1, quantity: 4, minStockLevel: 0 },
      { variantId: 102, branchId: 1, quantity: 3, minStockLevel: 0 },
      { variantId: 103, branchId: 1, quantity: 0, minStockLevel: 0 },
      // Same garment sitting in branch 2. Must never be added to branch 1.
      { variantId: 101, branchId: 2, quantity: 50, minStockLevel: 0 },
      { variantId: 103, branchId: 2, quantity: 7, minStockLevel: 0 },
      { variantId: 201, branchId: 1, quantity: 0, minStockLevel: 0 },
      { variantId: 201, branchId: 2, quantity: 9, minStockLevel: 0 },
    ];

    // Behaves like the real groupBy: filter by branch and variant, then sum.
    const mockGroupBy = () =>
      prismaMock.inventory.groupBy.mockImplementation(async ({ where }: any) => {
        const ids: number[] = where.variantId.in;
        const matched = inventoryRows.filter(
          (r) => r.branchId === where.branchId && ids.includes(r.variantId)
        );
        const sums = new Map<number, { quantity: number; minStockLevel: number }>();
        for (const r of matched) {
          const acc = sums.get(r.variantId) ?? { quantity: 0, minStockLevel: 0 };
          acc.quantity += r.quantity;
          acc.minStockLevel += r.minStockLevel;
          sums.set(r.variantId, acc);
        }
        return [...sums].map(([variantId, _sum]) => ({ variantId, _sum }));
      });

    it('sums stock across a product variants, for the branch in context only', async () => {
      prismaMock.product.findMany.mockResolvedValue([multiVariant]);
      prismaMock.product.count.mockResolvedValue(1);
      mockGroupBy();

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      // 4 + 3 + 0 at branch 1. The 57 pieces in branch 2 are another shop's.
      expect(res.body.data[0].stockQuantity).toBe(7);
      expect(res.body.data[0].isLowStock).toBe(false);
      expect(prismaMock.inventory.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ branchId: 1 }) })
      );
    });

    it('reports zero (not blank) when nothing is in stock at this branch', async () => {
      prismaMock.product.findMany.mockResolvedValue([soldOut]);
      prismaMock.product.count.mockResolvedValue(1);
      mockGroupBy();

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data[0].stockQuantity).toBe(0);
      // quantity <= minStockLevel, the existing low-stock rule, rolled up.
      expect(res.body.data[0].isLowStock).toBe(true);
    });

    it('treats a variant with no inventory row at this branch as zero', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        { ...fakeProduct, id: 40, variants: [{ id: 999 }] },
      ]);
      prismaMock.product.count.mockResolvedValue(1);
      mockGroupBy();

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data[0].stockQuantity).toBe(0);
    });

    it('resolves a whole page of products in ONE stock query (no N+1)', async () => {
      prismaMock.product.findMany.mockResolvedValue([multiVariant, soldOut, noVariants]);
      prismaMock.product.count.mockResolvedValue(3);
      mockGroupBy();

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(prismaMock.inventory.groupBy).toHaveBeenCalledTimes(1);
      expect(prismaMock.inventory.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variantId: { in: [101, 102, 103, 201] },
          }),
        })
      );
      expect(res.body.data.map((p: any) => p.stockQuantity)).toEqual([7, 0, 0]);
    });

    it('skips the stock query entirely when the page has no variants', async () => {
      prismaMock.product.findMany.mockResolvedValue([noVariants]);
      prismaMock.product.count.mockResolvedValue(1);
      mockGroupBy();

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data[0].stockQuantity).toBe(0);
      expect(prismaMock.inventory.groupBy).not.toHaveBeenCalled();
    });

    it('follows the owner branch switch sent as X-Branch-Id', async () => {
      prismaMock.product.findMany.mockResolvedValue([multiVariant]);
      prismaMock.product.count.mockResolvedValue(1);
      mockGroupBy();

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .set('X-Branch-Id', '2');

      expect(res.status).toBe(200);
      // 50 + 7 at branch 2.
      expect(res.body.data[0].stockQuantity).toBe(57);
    });

    it('counts a low stock product against its rolled-up minStockLevel', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        { ...fakeProduct, id: 50, variants: [{ id: 301 }, { id: 302 }] },
      ]);
      prismaMock.product.count.mockResolvedValue(1);
      prismaMock.inventory.groupBy.mockResolvedValue([
        { variantId: 301, _sum: { quantity: 1, minStockLevel: 2 } },
        { variantId: 302, _sum: { quantity: 1, minStockLevel: 3 } },
      ]);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data[0].stockQuantity).toBe(2);
      expect(res.body.data[0].minStockLevel).toBe(5);
      expect(res.body.data[0].isLowStock).toBe(true);
    });
  });

  // ─── GET /:id (get product by id) ───────────────────────────
  describe('GET /:id (get product by id)', () => {
    it('should return a product by id', async () => {
      prismaMock.product.findUnique.mockResolvedValue(fakeProduct);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
    });

    it('should return 404 for non-existent product', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get(`${BASE}/abc`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id (update product) ──────────────────────────────
  describe('PUT /:id (update product)', () => {
    it('should update product fields', async () => {
      prismaMock.product.findUnique
        .mockResolvedValueOnce(fakeProduct) // existence check
        .mockResolvedValueOnce(null);       // slug uniqueness (no collision)
      prismaMock.product.update.mockResolvedValue({
        ...fakeProduct,
        name: 'Updated Polo',
        basePrice: 2000,
      });

      const res = await request(app)
        .put(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ name: 'Updated Polo', basePrice: 2000 });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Polo');
    });

    it('should return 404 for non-existent product', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ name: 'X' });

      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /:id (soft delete) ──────────────────────────────
  describe('DELETE /:id (soft delete)', () => {
    it('should soft-delete (deactivate) a product', async () => {
      prismaMock.product.findUnique.mockResolvedValue(fakeProduct);
      prismaMock.product.update.mockResolvedValue({ ...fakeProduct, isActive: false });

      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/deactivated/i);
    });

    it('should return 404 for non-existent product', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /:id/variants (add variant with auto SKU+barcode) ─
  describe('POST /:id/variants (add variant)', () => {
    it('should add a variant with auto-generated SKU and barcode', async () => {
      prismaMock.product.findUnique.mockResolvedValue({
        ...fakeProduct,
        brand: fakeBrand,
      });
      prismaMock.productVariant.create.mockImplementation(async (args: any) => ({
        id: 10,
        productId: 1,
        sku: args.data.sku,
        barcode: args.data.barcode,
        size: args.data.size,
        color: args.data.color,
        priceOverride: null,
        costOverride: null,
        isActive: true,
      }));
      prismaMock.branch.findMany.mockResolvedValue([]);
      prismaMock.inventory.createMany.mockResolvedValue({ count: 0 });
      // nextBarcodes reads MAX(barcode) over raw SQL; no rows → start at base.
      prismaMock.$queryRawUnsafe.mockResolvedValue([{ m: null }]);

      const res = await request(app)
        .post(`${BASE}/1/variants`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ size: 'L', color: 'Navy' });

      expect(res.status).toBe(201);
      expect(res.body.data.size).toBe('L');
      expect(res.body.data.color).toBe('Navy');
      // SKU follows BRA-NAM-SIZE-COL-RAND pattern
      expect(res.body.data.sku).toMatch(/^TES-CLA-L-NAV-[A-F0-9]{4}$/);
      // Barcode is 9-digit sequential (not EAN-13 — see barcode/SKU scheme)
      expect(res.body.data.barcode).toMatch(/^\d{9}$/);
    });

    it('should return 404 if product does not exist', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/999/variants`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ size: 'M', color: 'Red' });

      expect(res.status).toBe(404);
    });
  });

  // ─── Variant uniqueness ─────────────────────────────────────
  describe('Variant uniqueness', () => {
    it('should reject duplicate variant creation when Prisma throws unique constraint', async () => {
      prismaMock.product.findUnique.mockResolvedValue({
        ...fakeProduct,
        brand: fakeBrand,
      });

      // Simulate Prisma unique constraint error
      const prismaError = new Error('Unique constraint failed on the fields: (`sku`)');
      (prismaError as any).code = 'P2002';
      prismaMock.productVariant.create.mockRejectedValue(prismaError);

      const res = await request(app)
        .post(`${BASE}/1/variants`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ size: 'L', color: 'Navy' });

      // The error propagates to the errorHandler which returns 500 for unhandled Prisma errors
      expect(res.status).toBe(500);
    });
  });
});
