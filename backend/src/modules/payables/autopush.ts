/**
 * §6 — auto-push: payroll and commission raise their own ledger rows.
 *
 * Nothing in here opens a connection of its own. Every function takes the
 * caller's `tx`, so the Payable and the SalaryPeriod (or the Commission rows)
 * are written in ONE transaction: a salary can never be finalised without its
 * ledger line, and a ledger line can never exist for a month that was never
 * finalised.
 *
 * Amounts are COPIED onto the payable, never referenced. Editing an old
 * month's attendance recomputes the SalaryPeriod, but a settled ledger row is
 * frozen — the guards below refuse to move a payable that has money against it.
 */
import { AppError } from '../../middleware/errorHandler';
import { Ym, dateOnly, daysInMonth, monthLabel } from '../../utils/ist';
import {
  EPSILON,
  PayPayableInput,
  dedupeKeys,
  payWithinTx,
  r2,
  statusFor,
} from './service';

/** The one system category payroll and commission both post to (§4.1). */
export const SALARY_CATEGORY = 'Salaries';

/** A salary payment intent, as handed over by the payroll module. */
export interface SalaryPayment {
  amount: number;
  method: PayPayableInput['method'];
  paidAt: Date;
  reference?: string | null;
  notes?: string | null;
  createdBy: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Salaries and commission for a month fall due on its last IST day. */
const monthEnd = (month: Ym): Date => dateOnly(`${month}-${pad2(daysInMonth(month))}`);

const nameOf = (user: any, userId: number): string =>
  user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || `Employee #${userId}` : `Employee #${userId}`;

/**
 * Resolve the system "Salaries" category, creating it if the store never had
 * one. Never throws: a missing category must not block a payout, and
 * Payable.categoryId is nullable by design.
 */
export async function salaryCategoryId(tx: any): Promise<number | null> {
  const bySystem = await tx.expenseCategory.findFirst({
    where: { isSystem: true, name: { equals: SALARY_CATEGORY, mode: 'insensitive' } },
  });
  if (bySystem?.id) return bySystem.id;

  const byName = await tx.expenseCategory.findFirst({
    where: { name: { equals: SALARY_CATEGORY, mode: 'insensitive' } },
  });
  if (byName?.id) return byName.id;

  try {
    const created = await tx.expenseCategory.create({
      data: {
        name: SALARY_CATEGORY,
        isSystem: true,
        isRecurring: false,
        isActive: true,
        sortOrder: 0,
      },
    });
    return created?.id ?? null;
  } catch {
    // Lost a race, or the name is taken by something we can't see. Post the
    // payable uncategorised rather than refusing to pay anyone.
    return null;
  }
}

// ─── Salary (D6) ─────────────────────────────────────────────────────────

/**
 * Step 1 of D6 — finalising a month ACCRUES the salary as a pending payable.
 * Idempotent on `payroll:{salaryPeriodId}`: re-finalising after a reopen
 * rewrites the same row instead of doubling the books.
 */
export async function pushSalaryPayable(tx: any, salaryPeriod: any, createdBy: number) {
  const dedupeKey = dedupeKeys.payroll(salaryPeriod.id);
  const month = salaryPeriod.month as Ym;
  const amount = r2(Number(salaryPeriod.netAmount ?? 0));

  const existing = await tx.payable.findUnique({ where: { dedupeKey } });
  if (existing && Number(existing.paidAmount ?? 0) > EPSILON) {
    throw new AppError(
      `The ${monthLabel(month)} salary entry already has payments recorded — reverse them before recalculating the month`,
      409
    );
  }

  const shared = {
    branchId: salaryPeriod.branchId,
    categoryId: existing?.categoryId ?? (await salaryCategoryId(tx)),
    periodMonth: month,
    title: `Salary – ${nameOf(salaryPeriod.user, salaryPeriod.userId)} – ${monthLabel(month)}`,
    amount,
    dueDate: monthEnd(month),
    status: statusFor(amount, 0),
    isSystem: true,
    sourceRefType: 'salary_period',
    sourceRefId: salaryPeriod.id,
  };

  const payable = await tx.payable.upsert({
    where: { dedupeKey },
    update: shared,
    create: {
      ...shared,
      source: 'payroll',
      userId: salaryPeriod.userId,
      dedupeKey,
      createdBy,
    },
  });

  if (payable?.id && salaryPeriod.payableId !== payable.id) {
    await tx.salaryPeriod.update({
      where: { id: salaryPeriod.id },
      data: { payableId: payable.id },
    });
  }

  return payable ?? null;
}

/**
 * Step 2 of D6 — the Paid action settles the payable raised at finalise.
 * The payment maths is not re-implemented here: it calls the payables
 * service's `payWithinTx` on the caller's transaction.
 *
 * Idempotent: a payable with nothing outstanding gets no second payment.
 */
export async function settleSalaryPayable(
  tx: any,
  salaryPeriod: any,
  payment: SalaryPayment
) {
  const dedupeKey = dedupeKeys.payroll(salaryPeriod.id);
  let payable = await tx.payable.findUnique({
    where: { dedupeKey },
    include: { payments: { select: { amount: true } } },
  });

  // Defensive: a month finalised before this wiring existed has no ledger row.
  // Raise it now rather than refusing the payout.
  if (!payable) payable = await pushSalaryPayable(tx, salaryPeriod, payment.createdBy);
  if (!payable?.id) return null;

  const total = r2(Number(payable.amount ?? 0));
  const prior = Array.isArray(payable.payments)
    ? payable.payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
    : Number(payable.paidAmount ?? 0);
  const outstanding = r2(total - prior);
  if (outstanding <= EPSILON) return payable;

  return payWithinTx(
    tx,
    payable.id,
    {
      amount: Math.min(r2(payment.amount), outstanding),
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      reference: payment.reference ?? null,
      notes: payment.notes ?? null,
    },
    payment.createdBy
  );
}

/**
 * Reopening a finalised month must retire its accrual, or the month gets
 * counted twice when it is finalised again. Refuses (409) once money has
 * actually moved — reverse the payment first.
 */
export async function voidSalaryPayable(tx: any, salaryPeriod: any) {
  const dedupeKey = dedupeKeys.payroll(salaryPeriod.id);
  const payable = await tx.payable.findUnique({
    where: { dedupeKey },
    include: { payments: { select: { id: true } } },
  });
  if (!payable?.id) return null;

  const hasPayments = Array.isArray(payable.payments)
    ? payable.payments.length > 0
    : Number(payable.paidAmount ?? 0) > EPSILON;
  if (hasPayments) {
    throw new AppError(
      `The ${monthLabel(salaryPeriod.month)} salary entry already has payments recorded — reverse them before reopening the month`,
      409
    );
  }
  if (payable.status === 'void') return payable;

  return tx.payable.update({ where: { id: payable.id }, data: { status: 'void' } });
}

// ─── Commission (D3) ─────────────────────────────────────────────────────

export interface CommissionBatch {
  userId: number;
  month: Ym;
  /** The batch total — ADDED to any existing payable for this employee-month. */
  amount: number;
  branchId: number;
  name: string;
  createdBy: number;
}

/**
 * One payable per (employee, month), keyed `commission:{userId}:{month}`.
 *
 * Commission is paid in batches — "pay 01–05 Aug", then "pay 06–12 Aug" — and
 * both batches belong to the same monthly liability. So a second batch ADDS to
 * the existing row's amount instead of creating a duplicate, and the status is
 * re-derived from the new total against what has actually been paid: a row that
 * was `paid` drops back to `part_paid` when more commission lands on it.
 *
 * Find-then-update rather than `upsert`, because the new amount depends on the
 * old one. Safe under the caller's transaction; the unique dedupeKey is the
 * backstop.
 */
export async function pushCommissionPayable(tx: any, batch: CommissionBatch) {
  const dedupeKey = dedupeKeys.commission(batch.userId, batch.month);
  const title = `Commission – ${batch.name} – ${monthLabel(batch.month)}`;
  const existing = await tx.payable.findUnique({ where: { dedupeKey } });

  if (existing?.id) {
    const total = r2(Number(existing.amount ?? 0) + r2(batch.amount));
    const paid = r2(Number(existing.paidAmount ?? 0));
    return tx.payable.update({
      where: { id: existing.id },
      data: { title, amount: total, status: statusFor(total, paid) },
    });
  }

  const amount = r2(batch.amount);
  return tx.payable.create({
    data: {
      branchId: batch.branchId,
      source: 'commission',
      categoryId: await salaryCategoryId(tx),
      userId: batch.userId,
      periodMonth: batch.month,
      title,
      amount,
      dueDate: monthEnd(batch.month),
      status: statusFor(amount, 0),
      isSystem: true,
      sourceRefType: 'commission_batch',
      dedupeKey,
      createdBy: batch.createdBy,
    },
  });
}
