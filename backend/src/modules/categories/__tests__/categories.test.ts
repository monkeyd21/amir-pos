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

const BASE = '/api/v1/categories';

const fakeCategory = {
  id: 1,
  name: 'T-Shirts',
  slug: 't-shirts',
  description: 'All T-shirts',
  parentId: null,
  isActive: true,
  createdAt: new Date(),
  _count: { products: 10 },
};

describe('Categories Module', () => {
  // ─── GET / (list categories) ─────────────────────────
  describe('GET / (list categories)', () => {
    it('should list categories', async () => {
      prismaMock.category.findMany.mockResolvedValue([fakeCategory]);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── GET /:id ────────────────────────────────────────
  describe('GET /:id', () => {
    it('should return a category by id', async () => {
      prismaMock.category.findUnique.mockResolvedValue(fakeCategory);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('T-Shirts');
    });

    it('should return 404 for non-existent category', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / (create category) ────────────────────────
  describe('POST / (create category)', () => {
    it('should create a category (owner)', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);
      prismaMock.category.create.mockResolvedValue(fakeCategory);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ name: 'T-Shirts' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('T-Shirts');
    });

    it('should return 403 if cashier tries to create category', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ name: 'Hats' });

      expect(res.status).toBe(403);
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id (update category) ──────────────────────
  describe('PUT /:id (update category)', () => {
    it('should update a category (manager)', async () => {
      prismaMock.category.findUnique.mockResolvedValue(fakeCategory);
      prismaMock.category.update.mockResolvedValue({ ...fakeCategory, name: 'Polo Shirts' });

      const res = await request(app)
        .put(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ name: 'Polo Shirts' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Polo Shirts');
    });
  });

  // ─── DELETE /:id ─────────────────────────────────────
  describe('DELETE /:id', () => {
    it('should delete a category (owner)', async () => {
      prismaMock.category.findUnique.mockResolvedValue(fakeCategory);
      prismaMock.category.update.mockResolvedValue({ ...fakeCategory, isActive: false });

      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 if cashier tries to delete category', async () => {
      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });
});
