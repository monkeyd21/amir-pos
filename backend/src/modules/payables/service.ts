import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';
import {
  Ym,
  Ymd,
  dateOnly,
  dueDateFor,
  istToday,
  monthBounds,
  monthLabel,
  ymdOf,
} from '../../utils/ist';
import { vendorOutstandingTotal } from '../vendors/service';

// Decimals arrive as strings; comparing money with `>=` after two roundings
// needs slack or a fully-paid row can miss `paid` by a hundredth of a paisa.
export const EPSILON = 0.005;

/** Round to paise. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

const OPEN_STATUSES: Prisma.EnumPayableStatusFilter = { in: ['pending', 'part_paid'] };

/** paidAmount vs amount → the only place a payable's status is decided. */
export const statusFor = (
  amount: number,
  paidAmount: number
): 'pending' | 'part_paid' | 'paid' => {
  if (paidAmount >= amount - EPSILON) return 'paid';
  if (paidAmount > EPSILON) return 'part_paid';
  return 'pending';
};

export const payableInclude = {
  category: { select: { id: true, name: true, isSystem: true, isRecurring: true } },
  subject: { select: { id: true, firstName: true, lastName: true } },
  payments: { orderBy: { paidAt: 'desc' as const } },
} satisfies Prisma.PayableInclude;

export interface ListPayablesQuery {
  month?: string;
  status?: string;
  source?: string;
  categoryId?: string;
  userId?: string;
  search?: string;
  page?: string;
  limit?: string;
}

export interface CreatePayableInput {
  title: string;
  amount: number;
  categoryId?: number | null;
  userId?: number | null;
  periodMonth?: string | null;
  dueDate?: string | null;
  description?: string | null;
  receiptUrl?: string | null;
}

export interface UpdatePayableInput {
  title?: string;
  amount?: number;
  categoryId?: number | null;
  periodMonth?: string | null;
  dueDate?: string | null;
  description?: string | null;
  receiptUrl?: string | null;
}

export interface PayPayableInput {
  amount: number;
  method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque';
  paidAt?: string | null;
  reference?: string | null;
  notes?: string | null;
  sessionId?: number | null;
}

class PayableService {
  // ─── Listing ───────────────────────────────────────────────────────────

  async list(query: ListPayablesQuery, branchId: number) {
    const { page, limit, skip } = getPagination(query);

    const where: Prisma.PayableWhereInput = { branchId };
    if (query.month) where.periodMonth = query.month;
    if (query.status) where.status = query.status as Prisma.PayableWhereInput['status'];
    if (query.source) where.source = query.source as Prisma.PayableWhereInput['source'];
    if (query.categoryId) where.categoryId = parseInt(query.categoryId, 10);
    if (query.userId) where.userId = parseInt(query.userId, 10);
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.payable.findMany({
        where,
        include: payableInclude,
        orderBy: [{ dueDate: 'asc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.payable.count({ where }),
    ]);

    return {
      data: (rows || []).map(shapePayable),
      meta: buildPaginationMeta(page, limit, total || 0),
    };
  }

  /**
   * A payable belongs to a branch, and only an owner may reach across branches.
   * Refused as 404 rather than 403 so an id from another branch doesn't confirm
   * its own existence.
   */
  private assertBranchAccess(payable: any, viewer?: Viewer) {
    if (!viewer || viewer.role === 'owner') return;
    if (payable && payable.branchId !== viewer.branchId) {
      throw new AppError('Entry not found', 404);
    }
  }

  async getById(id: number, viewer?: Viewer) {
    const payable = await prisma.payable.findUnique({ where: { id }, include: payableInclude });
    if (!payable) throw new AppError('Payable not found', 404);
    this.assertBranchAccess(payable, viewer);
    return shapePayable(payable);
  }

  // ─── Month materialisation (§4.1) ──────────────────────────────────────

  /**
   * Turn every active recurring category into one pending payable for `month`.
   *
   * Called on every page load, so it must be idempotent AND race-free: the
   * write is a single `upsert` on the unique `dedupeKey`, never a find-then-
   * create. `update: {}` is deliberate — a row the owner has already edited or
   * part-paid must never be reset by a later page load.
   *
   * System categories (Salaries) are skipped: payroll feeds those (§6).
   */
  async ensureMonth(month: Ym, branchId: number, userId: number) {
    const categories = await prisma.expenseCategory.findMany({
      where: { isActive: true, isRecurring: true, isSystem: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const keys = (categories || []).map((c: any) => dedupeKeys.recurring(branchId, c.id, month));
    const existing = keys.length
      ? await prisma.payable.findMany({
          where: { dedupeKey: { in: keys } },
          select: { dedupeKey: true },
        })
      : [];
    const known = new Set((existing || []).map((p: any) => p.dedupeKey));

    const payables = [];
    for (const category of categories || []) {
      const dedupeKey = dedupeKeys.recurring(branchId, category.id, month);
      const created = await prisma.payable.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          branchId,
          source: 'recurring_expense',
          categoryId: category.id,
          periodMonth: month,
          title: `${category.name} – ${monthLabel(month)}`,
          amount: category.defaultAmount ? Number(category.defaultAmount) : 0,
          dueDate: category.dueDay ? dateOnly(dueDateFor(month, category.dueDay)) : null,
          dedupeKey,
          isSystem: false,
          createdBy: userId,
        },
        include: payableInclude,
      });
      if (created) payables.push(shapePayable(created));
    }

    return {
      month,
      branchId,
      created: keys.filter((k) => !known.has(k)).length,
      existing: known.size,
      payables,
    };
  }

  // ─── Ad-hoc entry ──────────────────────────────────────────────────────

  async create(input: CreatePayableInput, branchId: number, userId: number) {
    if (input.categoryId) {
      const category = await prisma.expenseCategory.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new AppError('Expense category not found', 404);
      if (category.isSystem) {
        throw new AppError(
          `"${category.name}" is a system category — those entries are created by payroll, not by hand`,
          409
        );
      }
    }

    const payable = await prisma.payable.create({
      data: {
        branchId,
        source: 'adhoc_expense',
        categoryId: input.categoryId ?? null,
        userId: input.userId ?? null,
        periodMonth: input.periodMonth ?? null,
        title: input.title,
        description: input.description ?? null,
        amount: r2(Number(input.amount)),
        dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
        receiptUrl: input.receiptUrl ?? null,
        isSystem: false,
        createdBy: userId,
      },
      include: payableInclude,
    });

    return shapePayable(payable);
  }

  async update(id: number, input: UpdatePayableInput, viewer?: Viewer) {
    const payable = await prisma.payable.findUnique({ where: { id } });
    if (!payable) throw new AppError('Payable not found', 404);
    this.assertBranchAccess(payable, viewer);
    // §6 — auto-created rows are read-only here; correct them at the source
    // screen (payroll / commissions) and let the change flow down.
    if (payable.isSystem) {
      throw new AppError(
        'This entry is maintained by the system — edit it at the screen that created it',
        409
      );
    }
    if (payable.status === 'void') throw new AppError('This entry has been voided', 409);

    const data: Prisma.PayableUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.periodMonth !== undefined) data.periodMonth = input.periodMonth;
    if (input.receiptUrl !== undefined) data.receiptUrl = input.receiptUrl;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? dateOnly(input.dueDate) : null;
    if (input.categoryId !== undefined) {
      data.category = input.categoryId
        ? { connect: { id: input.categoryId } }
        : { disconnect: true };
    }
    if (input.amount !== undefined) {
      const amount = r2(Number(input.amount));
      const paidAmount = Number(payable.paidAmount);
      if (amount < paidAmount - EPSILON) {
        throw new AppError(
          `Amount cannot be less than the ₹${paidAmount} already paid against it`,
          400
        );
      }
      data.amount = amount;
      data.status = statusFor(amount, paidAmount);
    }

    const updated = await prisma.payable.update({ where: { id }, data, include: payableInclude });
    return shapePayable(updated);
  }

  /** Soft delete — the row stays for the audit trail, the money stops counting. */
  async void(id: number, viewer?: Viewer) {
    const payable = await prisma.payable.findUnique({
      where: { id },
      include: { payments: { select: { id: true } } },
    });
    if (!payable) throw new AppError('Payable not found', 404);
    this.assertBranchAccess(payable, viewer);
    if (payable.isSystem) {
      throw new AppError(
        'This entry is maintained by the system — cancel it at the screen that created it',
        409
      );
    }
    if ((payable.payments || []).length > 0) {
      throw new AppError('This entry already has payments recorded and cannot be voided', 409);
    }
    if (payable.status === 'void') return shapePayable(payable);

    const updated = await prisma.payable.update({
      where: { id },
      data: { status: 'void' },
      include: payableInclude,
    });
    return shapePayable(updated);
  }

  // ─── Paying (D6, D12) ──────────────────────────────────────────────────

  /**
   * Record a payment and re-derive the parent in the same transaction, so a
   * payment row can never exist without the parent's paidAmount moving.
   */
  async pay(id: number, input: PayPayableInput, userId: number, viewer?: Viewer) {
    if (viewer && viewer.role !== 'owner') {
      const owner = await prisma.payable.findUnique({
        where: { id },
        select: { branchId: true },
      });
      if (!owner) throw new AppError('Payable not found', 404);
      this.assertBranchAccess(owner, viewer);
    }
    return prisma.$transaction((tx: any) => payWithinTx(tx, id, input, userId));
  }

  // ─── Summary (§5) ──────────────────────────────────────────────────────

  async summary(
    range: { from?: string; to?: string; month?: string },
    branchId: number
  ) {
    let from = range.from;
    let to = range.to;
    if (range.month) {
      const { start, end } = monthBounds(range.month as Ym);
      from = ymdOf(start);
      to = ymdOf(new Date(end.getTime() - 86400000));
    }

    const window: Prisma.PayableWhereInput[] = [];
    if (from || to) {
      const bounds: Prisma.DateTimeFilter = {};
      if (from) bounds.gte = dateOnly(from as Ymd);
      if (to) bounds.lte = dateOnly(to as Ymd);
      const created: Prisma.DateTimeFilter = {};
      if (from) created.gte = dateOnly(from as Ymd);
      // createdAt is an instant — take the whole of the closing day.
      if (to) created.lt = new Date(dateOnly(to as Ymd).getTime() + 86400000);
      window.push({ dueDate: bounds }, { dueDate: null, createdAt: created });
    }

    const rows = await prisma.payable.findMany({
      where: {
        branchId,
        status: { not: 'void' },
        ...(window.length ? { OR: window } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
    });

    const byCategory = new Map<string, any>();
    const bySource = new Map<string, any>();
    let totalBilled = 0;
    let totalPaid = 0;

    for (const row of rows || []) {
      const amount = Number(row.amount);
      const paid = Number(row.paidAmount);
      totalBilled += amount;
      totalPaid += paid;

      const catKey = row.categoryId ? String(row.categoryId) : 'uncategorised';
      const cat = byCategory.get(catKey) || {
        categoryId: row.categoryId ?? null,
        name: row.category?.name ?? 'Uncategorised',
        billed: 0,
        paid: 0,
        outstanding: 0,
        count: 0,
      };
      cat.billed += amount;
      cat.paid += paid;
      cat.outstanding += amount - paid;
      cat.count += 1;
      byCategory.set(catKey, cat);

      const src = bySource.get(row.source) || {
        source: row.source,
        billed: 0,
        paid: 0,
        outstanding: 0,
        count: 0,
      };
      src.billed += amount;
      src.paid += paid;
      src.outstanding += amount - paid;
      src.count += 1;
      bySource.set(row.source, src);
    }

    const round = (g: any) => ({
      ...g,
      billed: r2(g.billed),
      paid: r2(g.paid),
      outstanding: r2(g.outstanding),
    });

    return {
      from: from ?? null,
      to: to ?? null,
      totals: {
        billed: r2(totalBilled),
        paid: r2(totalPaid),
        outstanding: r2(totalBilled - totalPaid),
        count: (rows || []).length,
      },
      byCategory: [...byCategory.values()].map(round).sort((a, b) => b.billed - a.billed),
      bySource: [...bySource.values()].map(round).sort((a, b) => b.billed - a.billed),
    };
  }

  // ─── Cash-flow read model (§7) ─────────────────────────────────────────

  /**
   * "Money owed out", broken into its real sources. Deliberately NOT one
   * opaque number: expenses, payroll and vendor credit live in different
   * ledgers and are settled by different people, so a single total would hide
   * which pile actually needs paying today.
   *
   * Gift-voucher balances are money owed to CUSTOMERS, not by the business to
   * a supplier — they are reported as customerLiability and stay out of
   * totalOwedOut.
   */
  async outstanding(branchId: number) {
    const today = istToday();
    const todayMs = dateOnly(today).getTime();
    const DAY = 86400000;

    const [rows, vendor, vouchers] = await Promise.all([
      prisma.payable.findMany({
        where: { branchId, status: OPEN_STATUSES },
        select: { source: true, amount: true, paidAmount: true, dueDate: true },
      }),
      vendorOutstandingTotal(),
      prisma.giftVoucher.findMany({
        where: { status: 'active' },
        select: { balance: true },
      }),
    ]);

    let expenses = 0;
    let expenseCount = 0;
    let payroll = 0;
    let payrollCount = 0;
    const aging = { overdue: 0, due7: 0, due30: 0 };

    for (const row of rows || []) {
      const owed = r2(Number(row.amount) - Number(row.paidAmount));
      if (owed <= EPSILON) continue;

      if (row.source === 'payroll' || row.source === 'commission') {
        payroll += owed;
        payrollCount += 1;
      } else {
        expenses += owed;
        expenseCount += 1;
      }

      if (!row.dueDate) continue;
      const diffDays = Math.round((dateOnly(ymdOf(row.dueDate)).getTime() - todayMs) / DAY);
      if (diffDays < 0) aging.overdue += owed;
      else if (diffDays <= 7) aging.due7 += owed;
      else if (diffDays <= 30) aging.due30 += owed;
    }

    const voucherTotal = (vouchers || []).reduce(
      (s: number, v: any) => s + Number(v.balance),
      0
    );

    const lines = [
      {
        kind: 'expenses' as const,
        label: 'Expenses due',
        amount: r2(expenses),
        count: expenseCount,
        source: 'payables',
      },
      {
        kind: 'payroll' as const,
        label: 'Salaries & commission due',
        amount: r2(payroll),
        count: payrollCount,
        source: 'payables',
      },
      {
        kind: 'vendor' as const,
        label: 'Vendor credit outstanding',
        amount: r2(vendor.totalOwed),
        count: vendor.vendorCount,
        source: 'vendor_ledger',
        note: 'Balance-forward: credit purchases minus vendor payments.',
      },
      {
        kind: 'voucher' as const,
        label: 'Gift voucher balances',
        amount: r2(voucherTotal),
        count: (vouchers || []).length,
        source: 'gift_vouchers',
        note: 'Owed to customers, not paid out in cash — excluded from money owed out.',
      },
    ];

    return {
      asOf: today,
      branchId,
      lines,
      aging: {
        overdue: r2(aging.overdue),
        due7: r2(aging.due7),
        due30: r2(aging.due30),
      },
      totalOwedOut: r2(expenses + payroll + vendor.totalOwed),
      customerLiability: r2(voucherTotal),
    };
  }

  // ─── Categories (§4.1) ─────────────────────────────────────────────────

  async listCategories(includeInactive = false) {
    const categories = await prisma.expenseCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return (categories || []).map((c: any) => ({
      ...c,
      defaultAmount: c.defaultAmount == null ? null : Number(c.defaultAmount),
    }));
  }

  async createCategory(input: {
    name: string;
    isRecurring?: boolean;
    defaultAmount?: number | null;
    dueDay?: number | null;
    sortOrder?: number;
    accountId?: number | null;
  }) {
    const existing = await prisma.expenseCategory.findUnique({ where: { name: input.name } });
    if (existing) throw new AppError('A category with that name already exists', 409);

    const category = await prisma.expenseCategory.create({
      data: {
        name: input.name,
        isRecurring: input.isRecurring ?? false,
        defaultAmount: input.defaultAmount ?? null,
        dueDay: input.dueDay ?? null,
        sortOrder: input.sortOrder ?? 0,
        accountId: input.accountId ?? null,
      },
    });
    return category;
  }

  async updateCategory(
    id: number,
    input: {
      name?: string;
      isRecurring?: boolean;
      defaultAmount?: number | null;
      dueDay?: number | null;
      sortOrder?: number;
      isActive?: boolean;
      accountId?: number | null;
    }
  ) {
    const category = await prisma.expenseCategory.findUnique({ where: { id } });
    if (!category) throw new AppError('Category not found', 404);
    // Salaries is fed by payroll (§6). Letting it also materialise a monthly
    // recurring row is exactly the duplicate-salary-entry bug the system
    // category flag exists to prevent.
    if (category.isSystem && input.isRecurring) {
      throw new AppError(
        `"${category.name}" is fed by payroll and cannot be made a recurring expense`,
        409
      );
    }

    const data: Prisma.ExpenseCategoryUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
    if (input.defaultAmount !== undefined) data.defaultAmount = input.defaultAmount;
    if (input.dueDay !== undefined) data.dueDay = input.dueDay;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.accountId !== undefined) {
      data.account = input.accountId ? { connect: { id: input.accountId } } : { disconnect: true };
    }

    return prisma.expenseCategory.update({ where: { id }, data });
  }
}

/**
 * Record one payment against a payable and re-derive the parent, on a
 * caller-supplied transaction.
 *
 * Extracted out of `pay()` so payroll's auto-push (§6) can settle its salary
 * payable inside the SAME transaction as the SalaryPeriod write — a salary can
 * never be marked paid without its payment row, or vice versa. There is exactly
 * one implementation of the payment maths, and this is it.
 */
export interface Viewer {
  role: string;
  branchId: number;
}

export async function payWithinTx(
  tx: any,
  id: number,
  input: PayPayableInput,
  userId: number
) {
  const amount = r2(Number(input.amount));
  if (!(amount > 0)) throw new AppError('Payment amount must be greater than zero', 400);

  // Lock the row for the rest of the transaction BEFORE reading what has been
  // paid so far. Prisma's interactive transactions run READ COMMITTED, so two
  // concurrent pays on the same bill would both read prior = 0, both pass the
  // over-payment check, and both insert a payment — paying ₹5,000 twice while
  // the payable still reads "₹5,000 paid, settled". The lock serialises them so
  // the second sees the first's payment and is refused as an overpayment.
  if (typeof tx.$queryRaw === 'function') {
    await tx.$queryRaw`SELECT id FROM payables WHERE id = ${id} FOR UPDATE`;
  }

  const payable = await tx.payable.findUnique({
    where: { id },
    include: { payments: { select: { amount: true } } },
  });
  if (!payable) throw new AppError('Payable not found', 404);
  if (payable.status === 'void') throw new AppError('This entry has been voided', 409);

  const total = Number(payable.amount);
  const priorRows = Array.isArray(payable.payments) ? payable.payments : null;
  const prior = priorRows
    ? priorRows.reduce((s: number, p: any) => s + Number(p.amount), 0)
    : Number(payable.paidAmount);
  const outstanding = r2(total - prior);

  if (amount > outstanding + EPSILON) {
    throw new AppError(
      `Payment of ₹${amount} exceeds the ₹${outstanding} still outstanding`,
      400
    );
  }

  const payment = await tx.payablePayment.create({
    data: {
      payableId: id,
      amount,
      method: input.method,
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      sessionId: input.sessionId ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: userId,
    },
  });

  const paidAmount = r2(prior + amount);
  const updated = await tx.payable.update({
    where: { id },
    data: { paidAmount, status: statusFor(total, paidAmount) },
    include: payableInclude,
  });

  return { ...shapePayable(updated), payment };
}

/**
 * The dedupe key formats, in one place. Every auto-created payable must carry
 * one so the creating job can be re-run without doubling the books.
 */
export const dedupeKeys = {
  recurring: (branchId: number, categoryId: number, month: string) =>
    `recurring:${branchId}:${categoryId}:${month}`,
  payroll: (salaryPeriodId: number) => `payroll:${salaryPeriodId}`,
  commission: (userId: number, month: string) => `commission:${userId}:${month}`,
  legacyExpense: (expenseId: number) => `legacy-expense:${expenseId}`,
};

/** Decimals cross the wire as strings — hand the UI real numbers. */
export function shapePayable(payable: any) {
  if (!payable) return payable;
  const amount = Number(payable.amount);
  const paidAmount = Number(payable.paidAmount);
  return {
    ...payable,
    amount: r2(amount),
    paidAmount: r2(paidAmount),
    outstanding: r2(Math.max(0, amount - paidAmount)),
    payments: Array.isArray(payable.payments)
      ? payable.payments.map((p: any) => ({ ...p, amount: Number(p.amount) }))
      : undefined,
  };
}

export const payableService = new PayableService();
export default payableService;
