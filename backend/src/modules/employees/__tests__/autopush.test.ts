import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';
import { onSalaryFinalised, onSalaryPaid, onSalaryReopened } from '../service';

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

const BASE = '/api/v1/employees';

// ─────────────────────────────────────────────────────
// A tiny in-memory payables store on top of prismaMock.
// Idempotency is the whole point of §6, and you cannot test idempotency
// against a mock that returns a canned row — the second call has to SEE what
// the first one wrote.
// ─────────────────────────────────────────────────────
function installPayableStore() {
  const rows = new Map<number, any>();
  const payments: any[] = [];
  let seq = 100;

  const byKey = (key: string) => [...rows.values()].find((r) => r.dedupeKey === key);
  const hydrate = (row: any, include?: any) => {
    if (!row) return null;
    const out: any = { ...row };
    if (include?.payments) out.payments = payments.filter((p) => p.payableId === row.id);
    return out;
  };

  prismaMock.expenseCategory.findFirst.mockResolvedValue({ id: 7, name: 'Salaries', isSystem: true });

  prismaMock.payable.findUnique.mockImplementation(async ({ where, include }: any) =>
    hydrate(where.dedupeKey ? byKey(where.dedupeKey) : rows.get(where.id), include)
  );
  prismaMock.payable.upsert.mockImplementation(async ({ where, update, create }: any) => {
    const existing = byKey(where.dedupeKey);
    if (existing) {
      Object.assign(existing, update);
      return { ...existing };
    }
    const row = { id: (seq += 1), paidAmount: 0, ...create };
    rows.set(row.id, row);
    return { ...row };
  });
  prismaMock.payable.create.mockImplementation(async ({ data }: any) => {
    const row = { id: (seq += 1), paidAmount: 0, ...data };
    rows.set(row.id, row);
    return { ...row };
  });
  prismaMock.payable.update.mockImplementation(async ({ where, data, include }: any) => {
    const row = rows.get(where.id);
    Object.assign(row, data);
    return hydrate(row, include);
  });
  prismaMock.payablePayment.create.mockImplementation(async ({ data }: any) => {
    const payment = { id: payments.length + 1, ...data };
    payments.push(payment);
    return payment;
  });

  return {
    rows,
    payments,
    all: () => [...rows.values()],
    byKey,
  };
}

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

const salaryPeriod = {
  id: 11,
  userId: 5,
  branchId: 1,
  month: '2026-06',
  salaryType: 'fixed_monthly',
  baseAmount: '18000',
  perDayRate: '700',
  manualDeductionTotal: '100',
  attendanceDeduction: '1750',
  netAmount: '16150',
  status: 'finalised',
  payableId: null,
  finalisedAt: new Date(),
  paidAt: null,
  user: { id: 5, firstName: 'Ramesh', lastName: 'Kumar' },
};

let store: ReturnType<typeof installPayableStore>;

beforeEach(() => {
  jest.clearAllMocks();
  store = installPayableStore();
  prismaMock.salaryPeriod.update.mockImplementation(async ({ data }: any) => ({
    ...salaryPeriod,
    ...data,
  }));
});

// ─────────────────────────────────────────────────────
// Salary → Payable (§6, D6)
// ─────────────────────────────────────────────────────
describe('§6 auto-push — salary accrual on finalise', () => {
  const finalise = () => {
    prismaMock.user.findUnique.mockResolvedValue(employee);
    prismaMock.salaryPeriod.findUnique.mockResolvedValue(null);
    prismaMock.attendance.findMany.mockResolvedValue([]);
    prismaMock.salaryPeriod.upsert.mockResolvedValue(salaryPeriod);
    return request(app)
      .post(`${BASE}/payroll/5/2026-06/finalise`)
      .set('Authorization', authHeader(testUsers.manager));
  };

  it('raises exactly one pending payable and links it to the period', async () => {
    const res = await finalise();

    expect(res.status).toBe(201);
    expect(store.all()).toHaveLength(1);

    const payable = store.byKey('payroll:11');
    expect(payable).toBeDefined();
    expect(payable.source).toBe('payroll');
    expect(payable.status).toBe('pending'); // D6 — accrued, not paid
    expect(payable.amount).toBe(16150);
    expect(payable.isSystem).toBe(true);
    expect(payable.userId).toBe(5);
    expect(payable.branchId).toBe(1);
    expect(payable.periodMonth).toBe('2026-06');
    expect(payable.categoryId).toBe(7); // resolved, never hardcoded
    expect(payable.sourceRefType).toBe('salary_period');
    expect(payable.sourceRefId).toBe(11);
    expect(payable.title).toBe('Salary – Ramesh Kumar – Jun 2026');
    // due on the last IST day of the accrual month
    expect(payable.dueDate.toISOString().slice(0, 10)).toBe('2026-06-30');

    const link = prismaMock.salaryPeriod.update.mock.calls.find(
      (c: any) => c[0]?.data?.payableId
    );
    expect(link[0].data.payableId).toBe(payable.id);
    expect(res.body.data.payableId).toBe(payable.id);
  });

  it('creates the Salaries category when the store has none', async () => {
    prismaMock.expenseCategory.findFirst.mockResolvedValue(null);
    prismaMock.expenseCategory.create.mockResolvedValue({ id: 42, name: 'Salaries' });

    const res = await finalise();

    expect(res.status).toBe(201);
    expect(prismaMock.expenseCategory.create.mock.calls[0][0].data).toMatchObject({
      name: 'Salaries',
      isSystem: true,
    });
    expect(store.byKey('payroll:11').categoryId).toBe(42);
  });

  it('never blocks a payroll run when the category cannot be resolved', async () => {
    prismaMock.expenseCategory.findFirst.mockResolvedValue(null);
    prismaMock.expenseCategory.create.mockRejectedValue(new Error('unique violation'));

    const res = await finalise();

    expect(res.status).toBe(201);
    expect(store.byKey('payroll:11').categoryId).toBeNull();
  });

  it('re-finalising the same period rewrites one row, never a second', async () => {
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);
    await onSalaryFinalised(prismaMock, { ...salaryPeriod, netAmount: '15000' }, 1);

    expect(store.all()).toHaveLength(1);
    expect(store.byKey('payroll:11').amount).toBe(15000);
  });

  it('refuses to move a payable that already has money against it', async () => {
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);
    store.byKey('payroll:11').paidAmount = 5000;

    await expect(
      onSalaryFinalised(prismaMock, { ...salaryPeriod, netAmount: '9000' }, 1)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(store.byKey('payroll:11').amount).toBe(16150); // copied, not moved
  });
});

describe('§6 auto-push — settling on Paid (D6 step 2)', () => {
  it('records one payment and flips the payable to paid', async () => {
    prismaMock.salaryPeriod.findUnique.mockResolvedValue(salaryPeriod);
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);

    const res = await request(app)
      .post(`${BASE}/payroll/5/2026-06/pay`)
      .set('Authorization', authHeader(testUsers.owner))
      .send({ method: 'cash', paidAt: '2026-07-01', reference: 'CASH-1' });

    expect(res.status).toBe(200);
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0]).toMatchObject({ amount: 16150, method: 'cash', createdBy: 1 });
    const payable = store.byKey('payroll:11');
    expect(payable.paidAmount).toBe(16150);
    expect(payable.status).toBe('paid');
  });

  it('paying the same salary twice makes ONE payable and ONE payment', async () => {
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);
    const intent = {
      amount: 16150,
      method: 'cash' as const,
      paidAt: new Date('2026-07-01T00:00:00Z'),
      reference: null,
      notes: null,
      createdBy: 1,
    };

    await onSalaryPaid(prismaMock, salaryPeriod, intent);
    await onSalaryPaid(prismaMock, salaryPeriod, intent);

    expect(store.all()).toHaveLength(1);
    expect(store.payments).toHaveLength(1);
    expect(store.byKey('payroll:11').paidAmount).toBe(16150);
  });

  it('raises the payable defensively if the month was finalised before §6 existed', async () => {
    const intent = {
      amount: 16150,
      method: 'upi' as const,
      paidAt: new Date('2026-07-01T00:00:00Z'),
      createdBy: 1,
    };

    await onSalaryPaid(prismaMock, salaryPeriod, intent);

    expect(store.all()).toHaveLength(1);
    expect(store.byKey('payroll:11').status).toBe('paid');
  });
});

describe('§6 auto-push — reopening voids the accrual', () => {
  it('finalise → pay → reopen: the paid month cannot be reopened', async () => {
    prismaMock.salaryPeriod.findUnique.mockResolvedValue({ ...salaryPeriod, status: 'paid' });

    const res = await request(app)
      .post(`${BASE}/payroll/5/2026-06/reopen`)
      .set('Authorization', authHeader(testUsers.owner));

    expect(res.status).toBe(409);
  });

  it('finalise → reopen voids the pending payable and clears the link', async () => {
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);
    prismaMock.salaryPeriod.findUnique.mockResolvedValue(salaryPeriod);

    const res = await request(app)
      .post(`${BASE}/payroll/5/2026-06/reopen`)
      .set('Authorization', authHeader(testUsers.owner));

    expect(res.status).toBe(200);
    expect(store.byKey('payroll:11').status).toBe('void');
    const call = prismaMock.salaryPeriod.update.mock.calls.at(-1)[0];
    expect(call.data.status).toBe('open');
    expect(call.data.payableId).toBeNull();
  });

  it('re-finalising after a reopen revives the same row at the new amount', async () => {
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);
    await onSalaryReopened(prismaMock, salaryPeriod);
    expect(store.byKey('payroll:11').status).toBe('void');

    await onSalaryFinalised(prismaMock, { ...salaryPeriod, netAmount: '14000' }, 1);

    expect(store.all()).toHaveLength(1);
    expect(store.byKey('payroll:11')).toMatchObject({ status: 'pending', amount: 14000 });
  });

  it('refuses to void a payable that has payments recorded', async () => {
    await onSalaryFinalised(prismaMock, salaryPeriod, 1);
    await onSalaryPaid(prismaMock, salaryPeriod, {
      amount: 5000,
      method: 'cash',
      paidAt: new Date('2026-07-01T00:00:00Z'),
      createdBy: 1,
    });

    await expect(onSalaryReopened(prismaMock, salaryPeriod)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

// ─────────────────────────────────────────────────────
// Commission → Payable (§6, D3)
// ─────────────────────────────────────────────────────
describe('§6 auto-push — commission (D3)', () => {
  const augDate = new Date(Date.UTC(2026, 7, 3));

  const payBulk = (body: any) =>
    request(app)
      .post(`${BASE}/commissions/pay-bulk`)
      .set('Authorization', authHeader(testUsers.owner))
      .send(body);

  /**
   * Rows the fake database holds. `commission.findMany` and `updateMany` honour
   * `where` against these — a mock that ignores `where` cannot tell the initial
   * read from the post-claim re-read, and cannot model a row a concurrent
   * caller has already claimed, which is exactly what these tests are for.
   */
  let commissionRows: any[] = [];

  const matches = (row: any, where: any = {}): boolean => {
    if (where.id !== undefined) {
      if (typeof where.id === 'object' && Array.isArray(where.id.in)) {
        if (!where.id.in.includes(row.id)) return false;
      } else if (row.id !== where.id) return false;
    }
    if (where.status !== undefined && (row.status ?? 'pending') !== where.status) return false;
    if (where.paidAt !== undefined && row.paidAt !== where.paidAt) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    return true;
  };

  const seedCommissions = (rows: any[]) => {
    commissionRows = rows.map((r) => ({ status: 'pending', paidAt: null, ...r }));
  };

  beforeEach(() => {
    commissionRows = [];
    prismaMock.user.findMany.mockResolvedValue([
      { id: 5, firstName: 'Ramesh', lastName: 'Kumar', branchId: 1 },
    ]);
    prismaMock.commission.findMany.mockImplementation(async ({ where }: any = {}) =>
      commissionRows.filter((r) => matches(r, where))
    );
    prismaMock.commission.updateMany.mockImplementation(async ({ where, data }: any) => {
      const hit = commissionRows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    });
    prismaMock.commission.update.mockImplementation(async ({ where, data }: any) => {
      const row = commissionRows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return { ...(row ?? { id: where.id }), user: { id: 5, firstName: 'Ramesh', lastName: 'Kumar' } };
    });
  });

  it('pushes one payable per employee-month and stamps the rows', async () => {
    seedCommissions([
      { id: 1, userId: 5, amount: '300', payPeriodStart: augDate },
      { id: 2, userId: 5, amount: '200.50', payPeriodStart: augDate },
    ]);

    const res = await payBulk({ startDate: '2026-08-01', endDate: '2026-08-05' });

    expect(res.status).toBe(200);
    expect(res.body.data.paidCount).toBe(2);
    expect(store.all()).toHaveLength(1);

    const payable = store.byKey('commission:5:2026-08');
    expect(payable.amount).toBe(500.5);
    expect(payable.source).toBe('commission');
    expect(payable.isSystem).toBe(true);
    expect(payable.status).toBe('pending');
    expect(payable.title).toBe('Commission – Ramesh Kumar – Aug 2026');
    expect(payable.sourceRefType).toBe('commission_batch');

    // Two writes, in this order: CLAIM the rows (guarded on `status:'pending'`,
    // which is what makes a double-click a no-op), then stamp the payable id.
    const claim = prismaMock.commission.updateMany.mock.calls[0][0];
    expect(claim.where.id.in).toEqual([1, 2]);
    expect(claim.where.status).toBe('pending');
    expect(claim.data.status).toBe('paid');
    expect(claim.data.paidAt).toBeInstanceOf(Date);

    const stamp = prismaMock.commission.updateMany.mock.calls[1][0];
    expect(stamp.data.payableId).toBe(payable.id);
    expect(commissionRows.every((r: any) => r.payableId === payable.id)).toBe(true);
  });

  it('a second batch in the same month ADDS to the one payable', async () => {
    seedCommissions([
      { id: 1, userId: 5, amount: '300', payPeriodStart: augDate },
    ]);
    await payBulk({ startDate: '2026-08-01', endDate: '2026-08-05' });

    seedCommissions([
      { id: 9, userId: 5, amount: '450', payPeriodStart: new Date(Date.UTC(2026, 7, 20)) },
    ]);
    const res = await payBulk({ startDate: '2026-08-15', endDate: '2026-08-25' });

    expect(res.status).toBe(200);
    expect(store.all()).toHaveLength(1);
    expect(store.byKey('commission:5:2026-08').amount).toBe(750);
  });

  it('adding to an already-settled month drops it back to part_paid', async () => {
    seedCommissions([
      { id: 1, userId: 5, amount: '300', payPeriodStart: augDate },
    ]);
    await payBulk({ startDate: '2026-08-01', endDate: '2026-08-05' });

    // The owner settles the commission payable in full…
    const payable = store.byKey('commission:5:2026-08');
    payable.paidAmount = 300;
    payable.status = 'paid';

    // …then a late batch for the same month arrives.
    seedCommissions([
      { id: 9, userId: 5, amount: '200', payPeriodStart: augDate },
    ]);
    await payBulk({ startDate: '2026-08-20', endDate: '2026-08-25' });

    expect(store.byKey('commission:5:2026-08')).toMatchObject({
      amount: 500,
      paidAmount: 300,
      status: 'part_paid',
    });
  });

  it('splits a range that straddles a month boundary into two payables', async () => {
    seedCommissions([
      { id: 1, userId: 5, amount: '300', payPeriodStart: new Date(Date.UTC(2026, 6, 30)) },
      { id: 2, userId: 5, amount: '400', payPeriodStart: augDate },
    ]);

    await payBulk({ startDate: '2026-07-28', endDate: '2026-08-05' });

    expect(store.all()).toHaveLength(2);
    expect(store.byKey('commission:5:2026-07').amount).toBe(300);
    expect(store.byKey('commission:5:2026-08').amount).toBe(400);
  });

  it('does nothing when the range has no pending commission', async () => {
    seedCommissions([]);

    const res = await payBulk({ startDate: '2026-09-01', endDate: '2026-09-05' });

    expect(res.body.data.paidCount).toBe(0);
    expect(store.all()).toHaveLength(0);
  });

  it('paying a single commission stamps paidAt and pushes its month payable', async () => {
    seedCommissions([{ id: 3, userId: 5, amount: '125', payPeriodStart: augDate }]);
    prismaMock.commission.findUnique.mockResolvedValue({
      id: 3,
      userId: 5,
      amount: '125',
      status: 'pending',
      payPeriodStart: augDate,
      user: { id: 5, firstName: 'Ramesh', lastName: 'Kumar', branchId: 1 },
    });

    const res = await request(app)
      .put(`${BASE}/commissions/3/pay`)
      .set('Authorization', authHeader(testUsers.owner));

    expect(res.status).toBe(200);
    const payable = store.byKey('commission:5:2026-08');
    expect(payable.amount).toBe(125);

    // Claimed first (guarded on pending), then stamped with the payable.
    const claim = prismaMock.commission.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 3, status: 'pending' });
    expect(claim.data.status).toBe('paid');
    expect(claim.data.paidAt).toBeInstanceOf(Date);
    expect(prismaMock.commission.update.mock.calls[0][0].data.payableId).toBe(payable.id);
  });

  it('a double-clicked single payout claims the row once and bills it once', async () => {
    seedCommissions([{ id: 3, userId: 5, amount: '125', payPeriodStart: augDate }]);
    prismaMock.commission.findUnique.mockResolvedValue({
      id: 3,
      userId: 5,
      amount: '125',
      status: 'pending',
      payPeriodStart: augDate,
      user: { id: 5, firstName: 'Ramesh', lastName: 'Kumar', branchId: 1 },
    });

    const first = await request(app)
      .put(`${BASE}/commissions/3/pay`)
      .set('Authorization', authHeader(testUsers.owner));
    expect(first.status).toBe(200);

    // findUnique still reports 'pending' — the stale read a second click makes.
    // The claim is what refuses it, so the payable is not billed twice.
    const second = await request(app)
      .put(`${BASE}/commissions/3/pay`)
      .set('Authorization', authHeader(testUsers.owner));
    expect(second.status).toBe(409);
    expect(store.all()).toHaveLength(1);
    expect(store.byKey('commission:5:2026-08').amount).toBe(125);
  });
});
