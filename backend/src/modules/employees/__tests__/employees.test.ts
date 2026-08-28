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

const BASE = '/api/v1/employees';

// Attendance is status-based now (§3.2) — clockIn/clockOut are dead legacy
// columns. The full attendance + payroll suite lives in payroll.test.ts.
const fakeAttendance = {
  id: 1,
  userId: 1,
  branchId: 1,
  date: new Date(Date.UTC(2026, 5, 8)),
  status: 'present',
  manualDeduction: '0',
  note: null,
  markedBy: 2,
  user: { id: 1, firstName: 'Admin', lastName: 'User' },
  branch: { id: 1, name: 'Main Branch' },
};

const fakeCommission = {
  id: 1,
  userId: 1,
  saleId: 1,
  amount: 150.0,
  rate: 5,
  status: 'pending',
  payPeriodStart: new Date('2025-01-01'),
  payPeriodEnd: new Date('2025-01-31'),
  createdAt: new Date(),
  user: { id: 1, firstName: 'Admin', lastName: 'User' },
  sale: { id: 1, saleNumber: 'S-001', total: 3000 },
};

describe('Employees Module', () => {
  // ─── GET /attendance ──────────────────────────────────
  describe('GET /attendance', () => {
    it('should list attendance records', async () => {
      prismaMock.attendance.findMany.mockResolvedValue([fakeAttendance]);
      prismaMock.attendance.count.mockResolvedValue(1);

      const res = await request(app)
        .get(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 403 for a cashier (attendance is owner/manager only)', async () => {
      const res = await request(app)
        .get(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /attendance/summary ──────────────────────────
  describe('GET /attendance/summary', () => {
    it('should return attendance summary for a month', async () => {
      prismaMock.attendance.groupBy.mockResolvedValue([
        { userId: 1, status: 'present', _count: { id: 22 }, _sum: { manualDeduction: '0' } },
        { userId: 1, status: 'absent', _count: { id: 2 }, _sum: { manualDeduction: '150' } },
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 1, firstName: 'Admin', lastName: 'User', branchId: 1 },
      ]);

      const res = await request(app)
        .get(`${BASE}/attendance/summary?month=2025-03`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toHaveLength(1);
      expect(res.body.data.summary[0].presentDays).toBe(22);
      expect(res.body.data.summary[0].absentDays).toBe(2);
      expect(res.body.data.summary[0].manualDeductionTotal).toBe(150);
    });

    it('should return 400 without month parameter', async () => {
      const res = await request(app)
        .get(`${BASE}/attendance/summary`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /commissions ─────────────────────────────────
  describe('GET /commissions', () => {
    it('should list commissions', async () => {
      prismaMock.commission.findMany.mockResolvedValue([fakeCommission]);
      prismaMock.commission.count.mockResolvedValue(1);
      // meta.totals is aggregated via groupBy(status) over the full filtered set.
      prismaMock.commission.groupBy.mockResolvedValue([
        { status: 'pending', _sum: { amount: 100 } },
      ] as any);

      const res = await request(app)
        .get(`${BASE}/commissions`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── PUT /commissions/:id/pay ─────────────────────────
  describe('PUT /commissions/:id/pay', () => {
    it('should mark commission as paid', async () => {
      prismaMock.commission.findUnique.mockResolvedValue(fakeCommission);
      // The row is CLAIMED with a `status: 'pending'` precondition before the
      // payable is pushed, so a double-click claims 0 rows and is refused.
      prismaMock.commission.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.commission.update.mockResolvedValue({ ...fakeCommission, status: 'paid' });

      const res = await request(app)
        .put(`${BASE}/commissions/1/pay`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
    });

    it('should return 404 for non-existent commission', async () => {
      prismaMock.commission.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`${BASE}/commissions/999/pay`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(404);
    });

    it('should return 400 if already paid', async () => {
      prismaMock.commission.findUnique.mockResolvedValue({ ...fakeCommission, status: 'paid' });

      const res = await request(app)
        .put(`${BASE}/commissions/1/pay`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already paid/i);
    });

    it('should return 403 if cashier tries to pay commission', async () => {
      const res = await request(app)
        .put(`${BASE}/commissions/1/pay`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });
});
