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

const BASE = '/api/v1/accounting';

describe('Accounting Module', () => {
  // ─── POST /journal-entries (balanced entry) ─────────────────
  describe('POST /journal-entries (balanced entry)', () => {
    it('should create a balanced journal entry', async () => {
      // Validate accounts exist
      prismaMock.account.findMany.mockResolvedValue([
        { id: 1, code: '1000', name: 'Cash', type: 'asset' },
        { id: 2, code: '4000', name: 'Sales Revenue', type: 'revenue' },
      ]);

      const entry = {
        id: 1,
        branchId: 1,
        entryNumber: 'JE-TEST-001',
        date: new Date('2025-03-15'),
        description: 'Cash sale',
        lines: [
          { id: 1, accountId: 1, debit: 1000, credit: 0, account: { id: 1, code: '1000', name: 'Cash', type: 'asset' } },
          { id: 2, accountId: 2, debit: 0, credit: 1000, account: { id: 2, code: '4000', name: 'Sales Revenue', type: 'revenue' } },
        ],
        branch: { id: 1, name: 'Main' },
      };
      prismaMock.journalEntry.create.mockResolvedValue(entry);

      const res = await request(app)
        .post(`${BASE}/journal-entries`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          branchId: 1,
          date: '2025-03-15',
          description: 'Cash sale',
          lines: [
            { accountId: 1, debit: 1000, credit: 0 },
            { accountId: 2, debit: 0, credit: 1000 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lines).toHaveLength(2);
    });
  });

  // ─── POST /journal-entries (unbalanced - rejected) ──────────
  describe('POST /journal-entries (unbalanced)', () => {
    it('should reject an unbalanced journal entry', async () => {
      const res = await request(app)
        .post(`${BASE}/journal-entries`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          branchId: 1,
          date: '2025-03-15',
          description: 'Bad entry',
          lines: [
            { accountId: 1, debit: 1000, credit: 0 },
            { accountId: 2, debit: 0, credit: 500 }, // imbalanced
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not balance/i);
    });

    it('should reject a line with both debit and credit', async () => {
      const res = await request(app)
        .post(`${BASE}/journal-entries`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          branchId: 1,
          date: '2025-03-15',
          description: 'Both sides',
          lines: [
            { accountId: 1, debit: 500, credit: 500 },
            { accountId: 2, debit: 0, credit: 0 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should reject a line with zero debit and zero credit', async () => {
      // Need to make the totals balance first (both 0 = balanced),
      // but individual line validation should catch the issue
      prismaMock.account.findMany.mockResolvedValue([
        { id: 1, code: '1000', name: 'Cash', type: 'asset' },
        { id: 2, code: '2000', name: 'Payable', type: 'liability' },
      ]);

      const res = await request(app)
        .post(`${BASE}/journal-entries`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          branchId: 1,
          date: '2025-03-15',
          description: 'Zero entry',
          lines: [
            { accountId: 1, debit: 0, credit: 0 },
            { accountId: 2, debit: 0, credit: 0 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should require at least 2 journal lines (validator)', async () => {
      const res = await request(app)
        .post(`${BASE}/journal-entries`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          branchId: 1,
          date: '2025-03-15',
          description: 'Single line',
          lines: [{ accountId: 1, debit: 1000, credit: 0 }],
        });

      expect(res.status).toBe(400);
    });

    it('should reject if cashier tries to create journal entry', async () => {
      const res = await request(app)
        .post(`${BASE}/journal-entries`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          branchId: 1,
          date: '2025-03-15',
          description: 'Test',
          lines: [
            { accountId: 1, debit: 100, credit: 0 },
            { accountId: 2, debit: 0, credit: 100 },
          ],
        });

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /pnl (Profit & Loss) ──────────────────────────────
  describe('GET /pnl (Profit & Loss)', () => {
    it('should return P&L with revenue, expenses, and net income', async () => {
      prismaMock.account.findMany
        .mockResolvedValueOnce([
          { id: 10, code: '4000', name: 'Sales Revenue', type: 'revenue', isActive: true },
        ])
        .mockResolvedValueOnce([
          { id: 20, code: '5000', name: 'COGS', type: 'expense', isActive: true },
          { id: 21, code: '5100', name: 'Rent', type: 'expense', isActive: true },
        ]);

      // Revenue totals (credit-normal)
      prismaMock.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 50000 } })   // Sales: net 50000
        .mockResolvedValueOnce({ _sum: { debit: 30000, credit: 0 } })   // COGS: net 30000
        .mockResolvedValueOnce({ _sum: { debit: 5000, credit: 0 } });   // Rent: net 5000

      const res = await request(app)
        .get(`${BASE}/pnl?startDate=2025-01-01&endDate=2025-12-31`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.data.revenue.total).toBe(50000);
      expect(res.body.data.expenses.total).toBe(35000);
      expect(res.body.data.netIncome).toBe(15000);
    });

    it('should require startDate and endDate', async () => {
      const res = await request(app)
        .get(`${BASE}/pnl`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /trial-balance ─────────────────────────────────────
  describe('GET /trial-balance', () => {
    it('should return a balanced trial balance', async () => {
      prismaMock.account.findMany.mockResolvedValue([
        { id: 1, code: '1000', name: 'Cash', type: 'asset', isActive: true },
        { id: 2, code: '2000', name: 'Accounts Payable', type: 'liability', isActive: true },
        { id: 3, code: '4000', name: 'Sales Revenue', type: 'revenue', isActive: true },
      ]);

      prismaMock.journalLine.aggregate
        // First pass (trialBalance loop)
        .mockResolvedValueOnce({ _sum: { debit: 10000, credit: 0 } })     // Cash
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 5000 } })      // AP
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 5000 } })      // Revenue
        // Second pass (result recompute)
        .mockResolvedValueOnce({ _sum: { debit: 10000, credit: 0 } })     // Cash
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 5000 } })      // AP
        .mockResolvedValueOnce({ _sum: { debit: 0, credit: 5000 } });     // Revenue

      const res = await request(app)
        .get(`${BASE}/trial-balance?asOfDate=2025-12-31`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.data.isBalanced).toBe(true);
      expect(res.body.data.totalDebits).toBe(res.body.data.totalCredits);
      expect(res.body.data.accounts.length).toBeGreaterThan(0);
    });

    it('should require asOfDate', async () => {
      const res = await request(app)
        .get(`${BASE}/trial-balance`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(400);
    });
  });
});
