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
  // ─── Retired write surface (spec §4.2 / §5, decision D13) ───────────────
  // Spend is recorded as payables now, and the reports read money-out from
  // payable_payments. A write that still landed in the legacy `expenses` table
  // would be counted nowhere — not in the daily summary, not in netRevenue,
  // not in /payables/outstanding — so the writes are closed rather than left
  // as a silent money leak. The approve/reject workflow is dropped with them:
  // it never had a UI, so nothing was ever approved through it.
  describe('retired write endpoints', () => {
    const retired: Array<[string, string, string]> = [
      ['post', `${BASE}`, 'POST /api/v1/payables'],
      ['put', `${BASE}/1`, 'PUT /api/v1/payables/:id'],
      ['put', `${BASE}/1/approve`, 'POST /api/v1/payables/:id/pay'],
      ['put', `${BASE}/1/reject`, 'DELETE /api/v1/payables/:id'],
      ['post', `${BASE}/categories`, 'POST /api/v1/payables/categories'],
      ['put', `${BASE}/categories/1`, 'PUT /api/v1/payables/categories/:id'],
    ];

    it.each(retired)('%s %s is gone, and says where to go instead', async (method, url, replacement) => {
      const res = await (request(app) as any)
        [method](url)
        .set('Authorization', authHeader(testUsers.owner))
        .send({});

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain(replacement);
    });

    it('does not write to the legacy expenses table', async () => {
      await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ branchId: 1, categoryId: 1, amount: 500, description: 'x', date: '2026-08-01', paymentMethod: 'cash' });

      expect(prismaMock.expense.create).not.toHaveBeenCalled();
    });
  });

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

});
