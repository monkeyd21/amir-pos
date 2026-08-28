import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';
import {
  computeMonth,
  computeSalary,
  countAttendance,
  emptyCounts,
  isPayrollConfigured,
  weeklyOffMismatch,
  DayCounts,
} from '../payroll';

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.clearAllMocks();
});

const counts = (over: Partial<DayCounts> = {}): DayCounts => ({ ...emptyCounts(), ...over });

// ─────────────────────────────────────────────────────
// The pure engine (spec §3.4)
// ─────────────────────────────────────────────────────
describe('payroll.computeSalary — the two formulas', () => {
  // ── The three worked examples from the spec ──
  it('fixed_monthly: 18000 base, 700/day, 2 absent + 1 half + 100 manual → 16150', () => {
    const r = computeSalary({
      salaryType: 'fixed_monthly',
      monthlySalary: 18000,
      perDayRate: 700,
      counts: counts({ absentDays: 2, halfDays: 1, presentDays: 27 }),
      manualDeductionTotal: 100,
    });
    expect(r.attendanceDeduction).toBe(1750); // 2*700 + 0.5*700
    expect(r.manualDeductionTotal).toBe(100);
    expect(r.netAmount).toBe(16150);
    expect(r.unrecoveredExcess).toBe(0);
  });

  it('fixed_monthly: 15000 base, 580/day, clean month → 15000', () => {
    const r = computeSalary({
      salaryType: 'fixed_monthly',
      monthlySalary: 15000,
      perDayRate: 580,
      counts: counts({ presentDays: 26, paidOffDays: 4 }),
      manualDeductionTotal: 0,
    });
    expect(r.attendanceDeduction).toBe(0);
    expect(r.netAmount).toBe(15000);
  });

  it('daily_wage: 600/day, 24 present + 2 half + 4 paid-off → 17400', () => {
    const r = computeSalary({
      salaryType: 'daily_wage',
      perDayRate: 600,
      counts: counts({ presentDays: 24, halfDays: 2, paidOffDays: 4 }),
      manualDeductionTotal: 0,
    });
    expect(r.earnedDays).toBe(29); // 24 + 1 + 4
    expect(r.netAmount).toBe(17400);
    expect(r.attendanceDeduction).toBe(0);
    expect(r.baseAmount).toBe(0);
  });

  // ── D5: late is a FULL PAID day in both formulas ──
  it('D5 — a late day is never deducted under fixed_monthly', () => {
    const r = computeSalary({
      salaryType: 'fixed_monthly',
      monthlySalary: 20000,
      perDayRate: 800,
      counts: counts({ presentDays: 25, lateDays: 5 }),
    });
    expect(r.attendanceDeduction).toBe(0);
    expect(r.netAmount).toBe(20000);
  });

  it('D5 — a late day is paid in full under daily_wage', () => {
    const r = computeSalary({
      salaryType: 'daily_wage',
      perDayRate: 500,
      counts: counts({ presentDays: 20, lateDays: 5 }),
    });
    expect(r.earnedDays).toBe(25);
    expect(r.netAmount).toBe(12500);
  });

  // ── D2: unmarked days ──
  it('D2 — unmarked days deduct NOTHING from a fixed monthly salary', () => {
    const withUnmarked = computeSalary({
      salaryType: 'fixed_monthly',
      monthlySalary: 18000,
      perDayRate: 700,
      counts: counts({ presentDays: 20, unmarkedDays: 10 }),
    });
    expect(withUnmarked.netAmount).toBe(18000);
  });

  it('D2 — unmarked days pay NOTHING on a daily wage', () => {
    const r = computeSalary({
      salaryType: 'daily_wage',
      perDayRate: 700,
      counts: counts({ presentDays: 20, unmarkedDays: 10 }),
    });
    expect(r.earnedDays).toBe(20);
    expect(r.netAmount).toBe(14000);
  });

  // ── D8: clamp at 0, report the excess, never carry it ──
  it('D8 — net clamps at 0 and reports the un-recovered excess', () => {
    const r = computeSalary({
      salaryType: 'fixed_monthly',
      monthlySalary: 10000,
      perDayRate: 700,
      counts: counts({ absentDays: 12 }), // 8400 deduction
      manualDeductionTotal: 3000, // total 11400 against 10000
    });
    expect(r.attendanceDeduction).toBe(8400);
    expect(r.netAmount).toBe(0);
    expect(r.unrecoveredExcess).toBe(1400);
  });

  it('D8 — a daily wage with a bigger deduction than earnings also clamps at 0', () => {
    const r = computeSalary({
      salaryType: 'daily_wage',
      perDayRate: 400,
      counts: counts({ presentDays: 2 }),
      manualDeductionTotal: 1000,
    });
    expect(r.netAmount).toBe(0);
    expect(r.unrecoveredExcess).toBe(200);
  });

  it('rounds money to 2 decimals', () => {
    const r = computeSalary({
      salaryType: 'fixed_monthly',
      monthlySalary: '18000.55',
      perDayRate: '733.33',
      counts: counts({ halfDays: 1 }),
      manualDeductionTotal: '0.10',
    });
    // 18000.55 - 366.665(→366.67) - 0.10
    expect(r.attendanceDeduction).toBe(366.67);
    expect(r.netAmount).toBe(17633.78);
  });

  it('coerces Decimal-as-string inputs before doing arithmetic', () => {
    const r = computeSalary({
      salaryType: 'daily_wage',
      perDayRate: '600',
      counts: counts({ presentDays: 10 }),
      manualDeductionTotal: '50',
    });
    expect(r.netAmount).toBe(5950);
  });
});

describe('payroll.countAttendance', () => {
  const june = '2026-06'; // 30 days
  const endOfJune = '2026-06-30';

  const mark = (day: number, status: any, manualDeduction = 0) => ({
    date: `${june}-${String(day).padStart(2, '0')}`,
    status,
    manualDeduction,
  });

  it('counts each status and sums manual deductions', () => {
    const r = countAttendance({
      month: june,
      salaryType: 'fixed_monthly',
      today: endOfJune,
      marks: [
        mark(1, 'present'),
        mark(2, 'absent'),
        mark(3, 'half_day', 50),
        mark(4, 'late'),
        mark(5, 'paid_weekly_off'),
        mark(6, 'present', 100),
      ],
    });
    expect(r.counts.presentDays).toBe(2);
    expect(r.counts.absentDays).toBe(1);
    expect(r.counts.halfDays).toBe(1);
    expect(r.counts.lateDays).toBe(1);
    expect(r.counts.paidOffDays).toBe(1);
    expect(r.manualDeductionTotal).toBe(150);
    expect(r.markedDays).toBe(6);
    expect(r.counts.unmarkedDays).toBe(24); // days 7..30
  });

  it('D2 — only ELAPSED days count as unmarked; future days do not', () => {
    const r = countAttendance({
      month: june,
      salaryType: 'daily_wage',
      today: '2026-06-15',
      marks: Array.from({ length: 10 }, (_, i) => mark(i + 1, 'present')),
    });
    expect(r.counts.presentDays).toBe(10);
    expect(r.counts.unmarkedDays).toBe(5); // 11..15
    expect(r.futureDays).toBe(15); // 16..30
  });

  it('D9 — pre-joining days are ABSENT for a fixed_monthly month', () => {
    const r = countAttendance({
      month: june,
      salaryType: 'fixed_monthly',
      joiningDate: '2026-06-10',
      today: endOfJune,
      marks: [],
    });
    expect(r.preJoiningDays).toBe(9);
    expect(r.counts.absentDays).toBe(9); // 1..9
    expect(r.counts.unmarkedDays).toBe(21); // 10..30
  });

  it('D9 — pre-joining days are NOT counted for a daily_wage month', () => {
    const r = countAttendance({
      month: june,
      salaryType: 'daily_wage',
      joiningDate: '2026-06-10',
      today: endOfJune,
      marks: [],
    });
    expect(r.preJoiningDays).toBe(9);
    expect(r.counts.absentDays).toBe(0);
    expect(r.counts.unmarkedDays).toBe(21);
  });

  it('handles a short month (February) without inventing days', () => {
    const r = countAttendance({
      month: '2026-02',
      salaryType: 'fixed_monthly',
      today: '2026-02-28',
      marks: [],
    });
    expect(r.days).toHaveLength(28);
    expect(r.counts.unmarkedDays).toBe(28);
  });
});

describe('payroll.computeMonth', () => {
  it('prices a mid-month joiner on a fixed monthly salary (D9)', () => {
    // Joined 16 Jun; days 1..15 are pre-joining → absent → 15 * 700 deducted.
    const r = computeMonth(
      '2026-06',
      { salaryType: 'fixed_monthly', monthlySalary: 18000, perDayRate: 700, joiningDate: '2026-06-16' },
      Array.from({ length: 15 }, (_, i) => ({
        date: `2026-06-${String(i + 16).padStart(2, '0')}`,
        status: 'present' as const,
      })),
      '2026-06-30'
    );
    expect(r.counts.absentDays).toBe(15);
    expect(r.counts.presentDays).toBe(15);
    expect(r.breakdown.attendanceDeduction).toBe(10500);
    expect(r.breakdown.netAmount).toBe(7500);
  });

  it('returns a zeroed breakdown when the employee has no salary config', () => {
    const r = computeMonth('2026-06', {}, [], '2026-06-30');
    expect(r.breakdown.netAmount).toBe(0);
    expect(r.breakdown.perDayRate).toBe(0);
  });
});

describe('payroll config guards', () => {
  it('requires a salary type and a per-day rate', () => {
    expect(isPayrollConfigured({})).toBe(false);
    expect(isPayrollConfigured({ salaryType: 'daily_wage' })).toBe(false);
    expect(isPayrollConfigured({ salaryType: 'daily_wage', perDayRate: 600 })).toBe(true);
  });

  it('also requires a monthly salary for fixed_monthly', () => {
    expect(isPayrollConfigured({ salaryType: 'fixed_monthly', perDayRate: 700 })).toBe(false);
    expect(
      isPayrollConfigured({ salaryType: 'fixed_monthly', perDayRate: 700, monthlySalary: 18000 })
    ).toBe(true);
  });

  it('flags a paid weekly off marked on a different weekday', () => {
    // 2026-06-07 is a Sunday.
    expect(weeklyOffMismatch('2026-06-07', 'paid_weekly_off', 0)).toBe(false);
    expect(weeklyOffMismatch('2026-06-08', 'paid_weekly_off', 0)).toBe(true);
    expect(weeklyOffMismatch('2026-06-08', 'present', 0)).toBe(false);
    expect(weeklyOffMismatch('2026-06-08', 'paid_weekly_off', null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────
const BASE = '/api/v1/employees';

const employee = {
  id: 5,
  firstName: 'Ramesh',
  lastName: 'Kumar',
  email: 'ramesh@test.com',
  phone: null,
  role: 'staff',
  isActive: true,
  branchId: 1,
  joiningDate: new Date(Date.UTC(2026, 0, 1)),
  salaryType: 'fixed_monthly',
  monthlySalary: '18000',
  perDayRate: '700',
  weeklyOffDay: 0,
};

describe('Attendance API (§3.2)', () => {
  describe('PUT /attendance', () => {
    it('upserts a day for an employee', async () => {
      prismaMock.user.findUnique.mockResolvedValue(employee);
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(null);
      prismaMock.attendance.upsert.mockResolvedValue({
        id: 1,
        userId: 5,
        date: new Date(Date.UTC(2026, 5, 8)),
        status: 'present',
        manualDeduction: '0',
      });

      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ userId: 5, date: '2026-06-08', status: 'present' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.attendance.status).toBe('present');
      expect(res.body.data.warnings).toEqual([]);
    });

    it('allows a paid weekly off on the wrong weekday but flags it', async () => {
      prismaMock.user.findUnique.mockResolvedValue(employee); // weeklyOffDay = Sunday
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(null);
      prismaMock.attendance.upsert.mockResolvedValue({ id: 1, status: 'paid_weekly_off' });

      // 2026-06-08 is a Monday.
      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ userId: 5, date: '2026-06-08', status: 'paid_weekly_off' });

      expect(res.status).toBe(200);
      expect(res.body.data.warnings).toHaveLength(1);
      expect(res.body.data.warnings[0]).toMatch(/weekly off/i);
    });

    it('D9 — refuses a date before the joining date', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...employee,
        joiningDate: new Date(Date.UTC(2026, 5, 15)),
      });

      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ userId: 5, date: '2026-06-08', status: 'present' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/joining date/i);
      expect(prismaMock.attendance.upsert).not.toHaveBeenCalled();
    });

    it('refuses to change a finalised month', async () => {
      prismaMock.user.findUnique.mockResolvedValue(employee);
      prismaMock.salaryPeriod.findUnique.mockResolvedValue({ status: 'finalised' });

      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ userId: 5, date: '2026-06-08', status: 'absent' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/reopen/i);
    });

    it('returns 404 for an unknown employee', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ userId: 999, date: '2026-06-08', status: 'present' });

      expect(res.status).toBe(404);
    });

    it('rejects an unknown status', async () => {
      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ userId: 5, date: '2026-06-08', status: 'holiday' });

      expect(res.status).toBe(400);
    });

    it('is forbidden to a cashier', async () => {
      const res = await request(app)
        .put(`${BASE}/attendance`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ userId: 5, date: '2026-06-08', status: 'present' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /attendance/bulk', () => {
    it('marks many employees for one day', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        employee,
        { ...employee, id: 6, firstName: 'Sita', weeklyOffDay: null },
      ]);
      prismaMock.salaryPeriod.findMany.mockResolvedValue([]);
      prismaMock.attendance.upsert.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .post(`${BASE}/attendance/bulk`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          date: '2026-06-08',
          entries: [
            { userId: 5, status: 'present' },
            { userId: 6, status: 'half_day', manualDeduction: 50 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.marked).toBe(2);
      expect(prismaMock.attendance.upsert).toHaveBeenCalledTimes(2);
    });

    it('writes nothing when the month is closed for one of them', async () => {
      prismaMock.user.findMany.mockResolvedValue([employee]);
      prismaMock.salaryPeriod.findMany.mockResolvedValue([{ userId: 5, status: 'paid' }]);

      const res = await request(app)
        .post(`${BASE}/attendance/bulk`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ date: '2026-06-08', entries: [{ userId: 5, status: 'present' }] });

      expect(res.status).toBe(409);
      expect(prismaMock.attendance.upsert).not.toHaveBeenCalled();
    });

    it('requires at least one entry', async () => {
      const res = await request(app)
        .post(`${BASE}/attendance/bulk`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ date: '2026-06-08', entries: [] });

      expect(res.status).toBe(400);
    });
  });
});

describe('Payroll API (§3.3)', () => {
  const salaryPeriod = {
    id: 11,
    userId: 5,
    branchId: 1,
    month: '2026-06',
    salaryType: 'fixed_monthly',
    baseAmount: '18000',
    perDayRate: '700',
    presentDays: 27,
    absentDays: 2,
    halfDays: 1,
    lateDays: 0,
    paidOffDays: 0,
    unmarkedDays: 0,
    manualDeductionTotal: '100',
    attendanceDeduction: '1750',
    netAmount: '16150',
    status: 'finalised',
    payableId: null,
    finalisedAt: new Date(),
    paidAt: null,
  };

  describe('GET /payroll', () => {
    it('lists every active employee for the month with day counts and net', async () => {
      prismaMock.user.findMany.mockResolvedValue([employee]);
      prismaMock.attendance.findMany.mockResolvedValue([
        { userId: 5, date: new Date(Date.UTC(2026, 5, 1)), status: 'absent', manualDeduction: '0' },
        { userId: 5, date: new Date(Date.UTC(2026, 5, 2)), status: 'absent', manualDeduction: '0' },
        { userId: 5, date: new Date(Date.UTC(2026, 5, 3)), status: 'half_day', manualDeduction: '100' },
      ]);
      prismaMock.salaryPeriod.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get(`${BASE}/payroll?month=2026-06`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      const row = res.body.data.rows[0];
      expect(row.userId).toBe(5);
      expect(row.counts.absentDays).toBe(2);
      expect(row.counts.halfDays).toBe(1);
      expect(row.attendanceDeduction).toBe(1750);
      expect(row.netAmount).toBe(16150); // the spec's worked example
      expect(row.status).toBe('open');
      expect(row.configured).toBe(true);
    });

    it('shows the SNAPSHOT once the month is settled (D10)', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { ...employee, monthlySalary: '25000', perDayRate: '900' }, // later pay rise
      ]);
      prismaMock.attendance.findMany.mockResolvedValue([]);
      prismaMock.salaryPeriod.findMany.mockResolvedValue([salaryPeriod]);

      const res = await request(app)
        .get(`${BASE}/payroll?month=2026-06`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      const row = res.body.data.rows[0];
      expect(row.netAmount).toBe(16150); // NOT recomputed against the new rate
      expect(row.perDayRate).toBe(700);
      expect(row.status).toBe('finalised');
    });

    it('requires a month', async () => {
      const res = await request(app)
        .get(`${BASE}/payroll`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(400);
    });

    it('is forbidden to a cashier', async () => {
      const res = await request(app)
        .get(`${BASE}/payroll?month=2026-06`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /payroll/:userId/:month', () => {
    it('returns a day-by-day grid plus the breakdown', async () => {
      prismaMock.user.findUnique.mockResolvedValue(employee);
      prismaMock.attendance.findMany.mockResolvedValue([
        { userId: 5, date: new Date(Date.UTC(2026, 5, 1)), status: 'present', manualDeduction: '0', note: null },
      ]);
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/payroll/5/2026-06`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.days).toHaveLength(30);
      expect(res.body.data.days[0].date).toBe('2026-06-01');
      expect(res.body.data.days[0].status).toBe('present');
      expect(res.body.data.employee.name).toBe('Ramesh Kumar');
    });

    it('rejects a malformed month', async () => {
      const res = await request(app)
        .get(`${BASE}/payroll/5/2026-6`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(400);
    });
  });

  // ── finalise → pay → reopen state machine (D6, D13) ──
  describe('POST /payroll/:userId/:month/finalise', () => {
    it('snapshots rates and counts and marks the month finalised', async () => {
      prismaMock.user.findUnique.mockResolvedValue(employee);
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(null);
      prismaMock.attendance.findMany.mockResolvedValue([
        { userId: 5, date: new Date(Date.UTC(2026, 5, 1)), status: 'absent', manualDeduction: '0' },
        { userId: 5, date: new Date(Date.UTC(2026, 5, 2)), status: 'absent', manualDeduction: '0' },
        { userId: 5, date: new Date(Date.UTC(2026, 5, 3)), status: 'half_day', manualDeduction: '100' },
      ]);
      prismaMock.salaryPeriod.upsert.mockResolvedValue(salaryPeriod);

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/finalise`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(201);
      const call = prismaMock.salaryPeriod.upsert.mock.calls[0][0];
      expect(call.create.perDayRate).toBe(700);
      expect(call.create.baseAmount).toBe(18000);
      expect(call.create.netAmount).toBe(16150);
      expect(call.create.absentDays).toBe(2);
      expect(call.create.status).toBe('finalised');
      expect(res.body.data.status).toBe('finalised');
    });

    it('refuses when the employee has no salary configured', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...employee,
        salaryType: null,
        monthlySalary: null,
        perDayRate: null,
      });

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/finalise`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not configured/i);
    });

    it('refuses to finalise twice', async () => {
      prismaMock.user.findUnique.mockResolvedValue(employee);
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(salaryPeriod);

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/finalise`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already finalised/i);
    });
  });

  describe('POST /payroll/:userId/:month/pay', () => {
    it('settles a finalised month', async () => {
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(salaryPeriod);
      prismaMock.salaryPeriod.update.mockResolvedValue({
        ...salaryPeriod,
        status: 'paid',
        paidAt: new Date(),
      });

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/pay`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ method: 'cash', paidAt: '2026-07-01' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      const call = prismaMock.salaryPeriod.update.mock.calls[0][0];
      expect(call.data.status).toBe('paid');
      expect(call.data.paidBy).toBe(testUsers.owner.userId);
    });

    it('refuses to pay a month that is still open (D6 — finalise first)', async () => {
      prismaMock.salaryPeriod.findUnique.mockResolvedValue({ ...salaryPeriod, status: 'open' });

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/pay`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ method: 'cash' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/finalise/i);
    });

    it('refuses to pay twice', async () => {
      prismaMock.salaryPeriod.findUnique.mockResolvedValue({ ...salaryPeriod, status: 'paid' });

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/pay`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ method: 'upi' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already paid/i);
    });

    it('404s when the month was never finalised', async () => {
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/pay`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ method: 'cash' });

      expect(res.status).toBe(404);
    });

    it('requires a valid pay method', async () => {
      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/pay`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ method: 'crypto' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /payroll/:userId/:month/reopen', () => {
    it('reopens a finalised month (owner)', async () => {
      prismaMock.salaryPeriod.findUnique.mockResolvedValue(salaryPeriod);
      prismaMock.salaryPeriod.update.mockResolvedValue({ ...salaryPeriod, status: 'open' });

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/reopen`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('open');
      expect(prismaMock.salaryPeriod.update.mock.calls[0][0].data.finalisedAt).toBeNull();
    });

    it('refuses to reopen a PAID month — reverse the payment first', async () => {
      prismaMock.salaryPeriod.findUnique.mockResolvedValue({ ...salaryPeriod, status: 'paid' });

      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/reopen`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/reverse the payment/i);
    });

    it('is forbidden to a manager (owner only)', async () => {
      const res = await request(app)
        .post(`${BASE}/payroll/5/2026-06/reopen`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(403);
    });
  });
});
