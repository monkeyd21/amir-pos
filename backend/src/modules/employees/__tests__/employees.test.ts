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

const fakeAttendance = {
  id: 1,
  userId: 1,
  branchId: 1,
  clockIn: new Date(),
  clockOut: null,
  hoursWorked: null,
  date: new Date(),
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
  // ─── POST /attendance/clock-in ────────────────────────
  describe('POST /attendance/clock-in', () => {
    it('should clock in successfully', async () => {
      prismaMock.attendance.findUnique.mockResolvedValue(null);
      prismaMock.attendance.create.mockResolvedValue(fakeAttendance);

      const res = await request(app)
        .post(`${BASE}/attendance/clock-in`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ branchId: 1 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('clockIn');
    });

    it('should return 400 if already clocked in today', async () => {
      prismaMock.attendance.findUnique.mockResolvedValue(fakeAttendance);

      const res = await request(app)
        .post(`${BASE}/attendance/clock-in`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ branchId: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already clocked in/i);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post(`${BASE}/attendance/clock-in`)
        .send({ branchId: 1 });

      expect(res.status).toBe(401);
    });
  });

  // ─── POST /attendance/clock-out ───────────────────────
  describe('POST /attendance/clock-out', () => {
    it('should clock out successfully', async () => {
      prismaMock.attendance.findUnique.mockResolvedValue(fakeAttendance);
      prismaMock.attendance.update.mockResolvedValue({
        ...fakeAttendance,
        clockOut: new Date(),
        hoursWorked: 8.5,
      });

      const res = await request(app)
        .post(`${BASE}/attendance/clock-out`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 if no clock-in record found', async () => {
      prismaMock.attendance.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/attendance/clock-out`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(400);
    });

    it('should return 400 if already clocked out', async () => {
      prismaMock.attendance.findUnique.mockResolvedValue({
        ...fakeAttendance,
        clockOut: new Date(),
      });

      const res = await request(app)
        .post(`${BASE}/attendance/clock-out`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already clocked out/i);
    });
  });

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
  });

  // ─── GET /attendance/summary ──────────────────────────
  describe('GET /attendance/summary', () => {
    it('should return attendance summary for a month', async () => {
      prismaMock.attendance.groupBy.mockResolvedValue([
        { userId: 1, _count: { id: 22 }, _sum: { hoursWorked: 176 } },
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 1, firstName: 'Admin', lastName: 'User', branchId: 1 },
      ]);

      const res = await request(app)
        .get(`${BASE}/attendance/summary?month=2025-03`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toHaveLength(1);
      expect(res.body.data.summary[0].daysPresent).toBe(22);
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
