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

const BASE = '/api/v1/customers';

const fakeCustomer = {
  id: 1,
  firstName: 'Ali',
  lastName: 'Khan',
  phone: '03001234567',
  email: 'ali@example.com',
  address: '123 Main St',
  loyaltyPoints: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Customers Module', () => {
  // ─── GET / (list) ────────────────────────────────────
  describe('GET / (list customers)', () => {
    it('should list customers with pagination', async () => {
      prismaMock.customer.findMany.mockResolvedValue([fakeCustomer]);
      prismaMock.customer.count.mockResolvedValue(1);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('total', 1);
    });

    it('should support search query', async () => {
      prismaMock.customer.findMany.mockResolvedValue([]);
      prismaMock.customer.count.mockResolvedValue(0);

      const res = await request(app)
        .get(`${BASE}?search=Ali`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /:id ────────────────────────────────────────
  describe('GET /:id', () => {
    it('should return a customer by id', async () => {
      prismaMock.customer.findUnique.mockResolvedValue({ ...fakeCustomer, sales: [] });

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Ali');
    });

    it('should return 404 for non-existent customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

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

  // ─── POST / (create) ────────────────────────────────
  describe('POST / (create customer)', () => {
    it('should create a customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue(fakeCustomer);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          firstName: 'Ali',
          lastName: 'Khan',
          phone: '03001234567',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Ali');
    });

    it('should return 409 for duplicate phone', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(fakeCustomer);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          firstName: 'Ali',
          lastName: 'Khan',
          phone: '03001234567',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ firstName: 'Ali' });

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id (update) ──────────────────────────────
  describe('PUT /:id (update customer)', () => {
    it('should update customer fields', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(fakeCustomer);
      prismaMock.customer.update.mockResolvedValue({ ...fakeCustomer, firstName: 'Ahmed' });

      const res = await request(app)
        .put(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ firstName: 'Ahmed' });

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Ahmed');
    });

    it('should return 404 for non-existent customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ firstName: 'Ahmed' });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /:id/history ────────────────────────────────
  describe('GET /:id/history (purchase history)', () => {
    it('should return purchase history for a customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(fakeCustomer);
      prismaMock.sale.findMany.mockResolvedValue([]);
      prismaMock.sale.count.mockResolvedValue(0);

      const res = await request(app)
        .get(`${BASE}/1/history`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent customer history', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999/history`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /:id/loyalty ────────────────────────────────
  describe('GET /:id/loyalty (loyalty history)', () => {
    it('should return loyalty history for a customer', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(fakeCustomer);
      prismaMock.loyaltyTransaction.findMany.mockResolvedValue([]);
      prismaMock.loyaltyTransaction.count.mockResolvedValue(0);

      const res = await request(app)
        .get(`${BASE}/1/loyalty`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
