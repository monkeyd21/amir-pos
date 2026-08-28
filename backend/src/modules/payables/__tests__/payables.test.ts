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

const BASE = '/api/v1/payables';

const rentCategory = {
  id: 4,
  name: 'Rent',
  isActive: true,
  isRecurring: true,
  isSystem: false,
  defaultAmount: '15000',
  dueDay: 5,
  sortOrder: 1,
};

const RENT_KEY = 'recurring:1:4:2026-08';

const rentPayable = {
  id: 11,
  branchId: 1,
  source: 'recurring_expense',
  categoryId: 4,
  periodMonth: '2026-08',
  title: 'Rent – Aug 2026',
  amount: '15000',
  paidAmount: '0',
  status: 'pending',
  isSystem: false,
  dedupeKey: RENT_KEY,
  payments: [],
};

describe('Payables Module', () => {
  // ─── POST /ensure-month — idempotent materialisation (§4.1) ────────────
  describe('POST /ensure-month', () => {
    it('materialises one payable per recurring category, and calling it twice does not double up', async () => {
      prismaMock.expenseCategory.findMany.mockResolvedValue([rentCategory]);
      prismaMock.payable.upsert.mockResolvedValue(rentPayable);

      // First page load — nothing exists yet.
      prismaMock.payable.findMany.mockResolvedValue([]);
      const first = await request(app)
        .post(`${BASE}/ensure-month`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ month: '2026-08' });

      expect(first.status).toBe(200);
      expect(first.body.data.created).toBe(1);

      const upsertArgs = prismaMock.payable.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ dedupeKey: RENT_KEY });
      // Never overwrite a row the owner has already edited or part-paid.
      expect(upsertArgs.update).toEqual({});
      expect(upsertArgs.create.title).toBe('Rent – Aug 2026');
      expect(upsertArgs.create.amount).toBe(15000);
      expect(upsertArgs.create.dueDate).toEqual(new Date(Date.UTC(2026, 7, 5)));

      // Second page load — the row is already there.
      jest.clearAllMocks();
      prismaMock.expenseCategory.findMany.mockResolvedValue([rentCategory]);
      prismaMock.payable.upsert.mockResolvedValue(rentPayable);
      prismaMock.payable.findMany.mockResolvedValue([{ dedupeKey: RENT_KEY }]);

      const second = await request(app)
        .post(`${BASE}/ensure-month`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ month: '2026-08' });

      expect(second.status).toBe(200);
      expect(second.body.data.created).toBe(0);
      expect(second.body.data.existing).toBe(1);
      // Still one upsert on the same key — one row, not two.
      expect(prismaMock.payable.upsert).toHaveBeenCalledTimes(1);
      expect(prismaMock.payable.upsert.mock.calls[0][0].where).toEqual({ dedupeKey: RENT_KEY });
    });

    it('skips system categories — payroll feeds Salaries', async () => {
      prismaMock.expenseCategory.findMany.mockResolvedValue([]);
      prismaMock.payable.findMany.mockResolvedValue([]);

      await request(app)
        .post(`${BASE}/ensure-month`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ month: '2026-08' });

      expect(prismaMock.expenseCategory.findMany.mock.calls[0][0].where).toEqual({
        isActive: true,
        isRecurring: true,
        isSystem: false,
      });
    });

    it('rejects a malformed month', async () => {
      const res = await request(app)
        .post(`${BASE}/ensure-month`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ month: 'August' });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /:id/pay — partial then full (D12) ───────────────────────────
  describe('POST /:id/pay', () => {
    it('a part payment moves the row to part_paid, and the balance closes it as paid', async () => {
      prismaMock.payable.findUnique.mockResolvedValue({
        ...rentPayable,
        amount: '1000',
        paidAmount: '0',
        payments: [],
      });
      prismaMock.payablePayment.create.mockResolvedValue({ id: 1, amount: '400' });
      prismaMock.payable.update.mockImplementation(async ({ data }: any) => ({
        ...rentPayable,
        amount: '1000',
        ...data,
      }));

      const partial = await request(app)
        .post(`${BASE}/11/pay`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ amount: 400, method: 'cash' });

      expect(partial.status).toBe(201);
      expect(prismaMock.payable.update.mock.calls[0][0].data).toEqual({
        paidAmount: 400,
        status: 'part_paid',
      });
      expect(partial.body.data.status).toBe('part_paid');
      expect(partial.body.data.outstanding).toBe(600);

      // Now settle the rest.
      jest.clearAllMocks();
      prismaMock.payable.findUnique.mockResolvedValue({
        ...rentPayable,
        amount: '1000',
        paidAmount: '400',
        status: 'part_paid',
        payments: [{ amount: '400' }],
      });
      prismaMock.payablePayment.create.mockResolvedValue({ id: 2, amount: '600' });
      prismaMock.payable.update.mockImplementation(async ({ data }: any) => ({
        ...rentPayable,
        amount: '1000',
        ...data,
      }));

      const full = await request(app)
        .post(`${BASE}/11/pay`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ amount: 600, method: 'upi', reference: 'UTR123' });

      expect(full.status).toBe(201);
      expect(prismaMock.payable.update.mock.calls[0][0].data).toEqual({
        paidAmount: 1000,
        status: 'paid',
      });
      expect(full.body.data.outstanding).toBe(0);
    });

    it('refuses to overpay', async () => {
      prismaMock.payable.findUnique.mockResolvedValue({
        ...rentPayable,
        amount: '1000',
        paidAmount: '900',
        status: 'part_paid',
        payments: [{ amount: '900' }],
      });

      const res = await request(app)
        .post(`${BASE}/11/pay`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ amount: 200, method: 'cash' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('exceeds');
      expect(prismaMock.payablePayment.create).not.toHaveBeenCalled();
    });

    it('refuses a non-positive amount', async () => {
      const res = await request(app)
        .post(`${BASE}/11/pay`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ amount: 0, method: 'cash' });

      expect(res.status).toBe(400);
    });

    it('refuses paying a voided entry', async () => {
      prismaMock.payable.findUnique.mockResolvedValue({
        ...rentPayable,
        status: 'void',
        payments: [],
      });

      const res = await request(app)
        .post(`${BASE}/11/pay`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ amount: 100, method: 'cash' });

      expect(res.status).toBe(409);
    });
  });

  // ─── System rows are read-only (§6) ────────────────────────────────────
  describe('system-owned entries', () => {
    const salaryPayable = {
      ...rentPayable,
      id: 22,
      source: 'payroll',
      isSystem: true,
      title: 'Salary – Ramesh Kumar – Aug 2026',
      payments: [],
    };

    it('refuses to edit a system payable with 409', async () => {
      prismaMock.payable.findUnique.mockResolvedValue(salaryPayable);

      const res = await request(app)
        .put(`${BASE}/22`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ amount: 999 });

      expect(res.status).toBe(409);
      expect(prismaMock.payable.update).not.toHaveBeenCalled();
    });

    it('refuses to void a system payable with 409', async () => {
      prismaMock.payable.findUnique.mockResolvedValue(salaryPayable);

      const res = await request(app)
        .delete(`${BASE}/22`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(409);
      expect(prismaMock.payable.update).not.toHaveBeenCalled();
    });

    it('refuses to void an entry that already has payments', async () => {
      prismaMock.payable.findUnique.mockResolvedValue({
        ...rentPayable,
        payments: [{ id: 1 }],
      });

      const res = await request(app)
        .delete(`${BASE}/11`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(409);
    });
  });

  // ─── GET /outstanding (§7) ─────────────────────────────────────────────
  describe('GET /outstanding', () => {
    it('reports sourced lines and keeps voucher liability OUT of totalOwedOut', async () => {
      prismaMock.payable.findMany.mockResolvedValue([
        { source: 'adhoc_expense', amount: '1000', paidAmount: '0', dueDate: null },
        {
          source: 'payroll',
          amount: '5000',
          paidAmount: '1000',
          dueDate: new Date(Date.UTC(2000, 0, 1)),
        },
      ]);
      // Vendor credit: 10 × ₹100 on credit, ₹400 paid → ₹600 owed.
      prismaMock.inventoryMovement.findMany.mockResolvedValue([
        { vendorId: 1, unitCost: '100', quantity: 10, paymentMode: 'credit' },
      ]);
      prismaMock.vendorPayment.findMany.mockResolvedValue([{ vendorId: 1, amount: '400' }]);
      prismaMock.giftVoucher.findMany.mockResolvedValue([
        { balance: '250' },
        { balance: '150' },
      ]);

      const res = await request(app)
        .get(`${BASE}/outstanding`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      const data = res.body.data;
      const line = (kind: string) => data.lines.find((l: any) => l.kind === kind);

      expect(line('expenses').amount).toBe(1000);
      expect(line('payroll').amount).toBe(4000);
      expect(line('vendor').amount).toBe(600);
      expect(line('voucher').amount).toBe(400);

      // 1000 + 4000 + 600 — the ₹400 of vouchers is owed to CUSTOMERS.
      expect(data.totalOwedOut).toBe(5600);
      expect(data.customerLiability).toBe(400);
      expect(line('voucher').note).toContain('excluded');

      // The overdue payroll row ages into `overdue`; the undated one ages nowhere.
      expect(data.aging.overdue).toBe(4000);
    });

    it('403s a cashier — the till has no business seeing what the store owes', async () => {
      const res = await request(app)
        .get(`${BASE}/outstanding`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });

  // ─── Ad-hoc entry + listing ────────────────────────────────────────────
  describe('POST / and GET /', () => {
    it('creates an ad-hoc payable on the caller branch', async () => {
      prismaMock.payable.create.mockResolvedValue({
        ...rentPayable,
        id: 33,
        source: 'adhoc_expense',
        title: 'Signboard repair',
        amount: '2500',
      });

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ title: 'Signboard repair', amount: 2500, dueDate: '2026-08-20' });

      expect(res.status).toBe(201);
      const data = prismaMock.payable.create.mock.calls[0][0].data;
      expect(data.branchId).toBe(1);
      expect(data.source).toBe('adhoc_expense');
      expect(data.dueDate).toEqual(new Date(Date.UTC(2026, 7, 20)));
      expect(res.body.data.amount).toBe(2500);
    });

    it('lists payables scoped to the branch, with Decimals as numbers', async () => {
      prismaMock.payable.findMany.mockResolvedValue([rentPayable]);
      prismaMock.payable.count.mockResolvedValue(1);

      const res = await request(app)
        .get(`${BASE}?month=2026-08&status=pending`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(prismaMock.payable.findMany.mock.calls[0][0].where).toMatchObject({
        branchId: 1,
        periodMonth: '2026-08',
        status: 'pending',
      });
      expect(res.body.data[0].amount).toBe(15000);
      expect(res.body.data[0].outstanding).toBe(15000);
    });
  });

  // ─── Categories ────────────────────────────────────────────────────────
  describe('categories', () => {
    it('lists categories (static route wins over /:id)', async () => {
      prismaMock.expenseCategory.findMany.mockResolvedValue([rentCategory]);

      const res = await request(app)
        .get(`${BASE}/categories`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.data[0].defaultAmount).toBe(15000);
      expect(prismaMock.payable.findUnique).not.toHaveBeenCalled();
    });

    it('refuses to make a system category recurring', async () => {
      prismaMock.expenseCategory.findUnique.mockResolvedValue({
        id: 6,
        name: 'Salaries',
        isSystem: true,
      });

      const res = await request(app)
        .put(`${BASE}/categories/6`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ isRecurring: true });

      expect(res.status).toBe(409);
    });
  });
  // ─── Branch scoping ─────────────────────────────────────────────────────
  describe('branch scoping', () => {
    // A manager is pinned to their own branch. Reaching another branch's
    // payable by id is refused as 404, not 403 — a 403 would confirm the id
    // exists, which is itself a leak.
    const otherBranchPayable = {
      id: 77,
      branchId: 2,
      source: 'adhoc_expense',
      title: 'Branch 2 rent',
      amount: '9000',
      paidAmount: '0',
      status: 'pending',
      isSystem: false,
      payments: [],
    };

    it('refuses a manager reading another branch\'s payable', async () => {
      prismaMock.payable.findUnique.mockResolvedValue(otherBranchPayable);

      const res = await request(app)
        .get(`${BASE}/77`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(404);
    });

    it('refuses a manager paying another branch\'s payable', async () => {
      prismaMock.payable.findUnique.mockResolvedValue(otherBranchPayable);

      const res = await request(app)
        .post(`${BASE}/77/pay`)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ amount: 9000, method: 'cash', paidAt: '2026-08-28' });

      expect(res.status).toBe(404);
      expect(prismaMock.payablePayment.create).not.toHaveBeenCalled();
    });

    it('lets the owner reach across branches', async () => {
      prismaMock.payable.findUnique.mockResolvedValue(otherBranchPayable);

      const res = await request(app)
        .get(`${BASE}/77`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
    });
  });

});
