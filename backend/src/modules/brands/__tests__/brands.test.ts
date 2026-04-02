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

const BASE = '/api/v1/brands';

const fakeBrand = {
  id: 1,
  name: 'Nike',
  slug: 'nike',
  description: 'Athletic brand',
  logoUrl: null,
  isActive: true,
  createdAt: new Date(),
  _count: { products: 5 },
};

describe('Brands Module', () => {
  // ─── GET / (list brands) ─────────────────────────────
  describe('GET / (list brands)', () => {
    it('should list brands with pagination', async () => {
      prismaMock.brand.findMany.mockResolvedValue([fakeBrand]);
      prismaMock.brand.count.mockResolvedValue(1);

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
    it('should return a brand by id', async () => {
      prismaMock.brand.findUnique.mockResolvedValue(fakeBrand);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Nike');
    });

    it('should return 404 for non-existent brand', async () => {
      prismaMock.brand.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / (create brand) ───────────────────────────
  describe('POST / (create brand)', () => {
    it('should create a brand (owner)', async () => {
      prismaMock.brand.findUnique.mockResolvedValue(null);
      prismaMock.brand.create.mockResolvedValue(fakeBrand);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ name: 'Nike', description: 'Athletic brand' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Nike');
    });

    it('should return 403 if cashier tries to create brand', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ name: 'Fake' });

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

  // ─── PUT /:id (update brand) ─────────────────────────
  describe('PUT /:id (update brand)', () => {
    it('should update a brand (manager)', async () => {
      prismaMock.brand.findUnique.mockResolvedValue(fakeBrand);
      prismaMock.brand.update.mockResolvedValue({ ...fakeBrand, name: 'Adidas' });

      const res = await request(app)
        .put(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ name: 'Adidas' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Adidas');
    });

    it('should return 404 for non-existent brand', async () => {
      prismaMock.brand.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ name: 'X' });

      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /:id ─────────────────────────────────────
  describe('DELETE /:id', () => {
    it('should delete a brand (owner)', async () => {
      prismaMock.brand.findUnique.mockResolvedValue(fakeBrand);
      prismaMock.brand.update.mockResolvedValue({ ...fakeBrand, isActive: false });

      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 if cashier tries to delete brand', async () => {
      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });
});
