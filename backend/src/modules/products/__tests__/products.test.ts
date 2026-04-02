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

    it('should return 409 for duplicate product name', async () => {
      prismaMock.product.findUnique.mockResolvedValue(fakeProduct); // slug collision

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

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
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

      const res = await request(app)
        .post(`${BASE}/1/variants`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ size: 'L', color: 'Navy' });

      expect(res.status).toBe(201);
      expect(res.body.data.size).toBe('L');
      expect(res.body.data.color).toBe('Navy');
      // SKU follows BRA-NAM-SIZE-COL-RAND pattern
      expect(res.body.data.sku).toMatch(/^TES-CLA-L-NAV-[A-F0-9]{4}$/);
      // Barcode is a 13-digit EAN-13
      expect(res.body.data.barcode).toMatch(/^\d{13}$/);
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
