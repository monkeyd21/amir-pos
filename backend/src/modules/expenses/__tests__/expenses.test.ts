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

const BASE = '/api/v1/expenses';

const fakeCategory = { id: 1, name: 'Rent', description: 'Monthly rent' };

const fakeExpense = {
  id: 1,
  branchId: 1,
  categoryId: 1,
  amount: 50000,
  description: 'March rent',
  date: new Date('2025-03-01'),
  paymentMethod: 'bank_transfer',
  receiptUrl: null,
  status: 'pending',
  createdBy: 1,
  approvedBy: null,
  category: fakeCategory,
  branch: { id: 1, name: 'Main Branch' },
  creator: { id: 1, firstName: 'Admin', lastName: 'User' },
  approver: null,
};

describe('Expenses Module', () => {
  // ─── GET / (list expenses) ───────────────────────────
  describe('GET / (list expenses)', () => {
    it('should list expenses with pagination', async () => {
      prismaMock.expense.findMany.mockResolvedValue([fakeExpense]);
      prismaMock.expense.count.mockResolvedValue(1);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /:id ────────────────────────────────────────
  describe('GET /:id', () => {
    it('should return expense by id', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(fakeExpense);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(50000);
    });

    it('should return 404 for non-existent expense', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / (create expense) ─────────────────────────
  describe('POST / (create expense)', () => {
    it('should create an expense', async () => {
      prismaMock.expense.create.mockResolvedValue(fakeExpense);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.manager))
        .send({
          branchId: 1,
          categoryId: 1,
          amount: 50000,
          description: 'March rent',
          date: '2025-03-01',
          paymentMethod: 'bank_transfer',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(50000);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ description: 'Incomplete' });

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id/approve ────────────────────────────────
  describe('PUT /:id/approve', () => {
    it('should approve an expense (owner)', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(fakeExpense);
      prismaMock.expense.update.mockResolvedValue({
        ...fakeExpense,
        status: 'approved',
        approvedBy: 1,
      });

      const res = await request(app)
        .put(`${BASE}/1/approve`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
    });

    it('should return 404 for non-existent expense', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`${BASE}/999/approve`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(404);
    });

    it('should return 403 if cashier tries to approve', async () => {
      const res = await request(app)
        .put(`${BASE}/1/approve`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });

  // ─── PUT /:id/reject ─────────────────────────────────
  describe('PUT /:id/reject', () => {
    it('should reject an expense (manager)', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(fakeExpense);
      prismaMock.expense.update.mockResolvedValue({
        ...fakeExpense,
        status: 'rejected',
        approvedBy: 2,
      });

      const res = await request(app)
        .put(`${BASE}/1/reject`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rejected');
    });

    it('should return 403 if cashier tries to reject', async () => {
      const res = await request(app)
        .put(`${BASE}/1/reject`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });

  // ─── Expense Categories ──────────────────────────────
  describe('GET /categories', () => {
    it('should list expense categories', async () => {
      prismaMock.expenseCategory.findMany.mockResolvedValue([fakeCategory]);

      const res = await request(app)
        .get(`${BASE}/categories`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /categories', () => {
    it('should create an expense category', async () => {
      prismaMock.expenseCategory.create.mockResolvedValue(fakeCategory);

      const res = await request(app)
        .post(`${BASE}/categories`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ name: 'Rent', description: 'Monthly rent' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Rent');
    });
  });
});
