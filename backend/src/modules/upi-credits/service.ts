import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../../services/audit';
import { autoMatch } from './matching';

/**
 * Dashboard spec §15.2 / §15.5: money that landed in the shop's UPI account,
 * from the bank or PSP statement, matched against the bills and pending sales
 * that explain it. Whatever matches nothing shows on the dashboard until a
 * person matches it, turns it into a pending sale, or marks it as not a sale
 * (an owner top-up, a supplier refund) with a reason.
 */

export interface CreditRow {
  receivedAt: string;
  amount: number;
  reference: string;
  payerName?: string | null;
  payerVpa?: string | null;
}

const DAY_MS = 24 * 3600_000;

const creditInclude = {
  matchedSale: { select: { id: true, saleNumber: true, total: true, createdAt: true } },
  matchedPendingSale: { select: { id: true, number: true, amountReceived: true, status: true } },
  resolver: { select: { firstName: true, lastName: true } },
} satisfies Prisma.UpiCreditInclude;

export class UpiCreditService {
  /**
   * Add statement rows. A reference already on file is skipped, so importing
   * an overlapping statement is harmless. Then try to match everything open.
   */
  async import(rows: CreditRow[], source: 'import' | 'manual', userId: number, branchId: number) {
    const batch = source === 'import' ? `B${Date.now().toString(36)}` : null;
    const parsed = rows.map((r, i) => {
      const at = new Date(r.receivedAt);
      if (Number.isNaN(at.getTime())) throw new AppError(`Row ${i + 1}: "${r.receivedAt}" is not a date and time`, 400);
      if (!(r.amount > 0)) throw new AppError(`Row ${i + 1}: the amount must be more than zero`, 400);
      const reference = r.reference.replace(/\s+/g, '').trim();
      if (reference.length < 4) throw new AppError(`Row ${i + 1}: a UTR / reference number is required`, 400);
      return {
        branchId,
        receivedAt: at,
        amount: Math.round(r.amount * 100) / 100,
        reference,
        payerName: r.payerName?.trim() || null,
        payerVpa: r.payerVpa?.trim() || null,
        source,
        importBatch: batch,
        createdBy: userId,
      };
    });

    const created = await prisma.upiCredit.createMany({ data: parsed, skipDuplicates: true });
    const matched = await this.autoMatchOpen(branchId);
    await recordAudit(prisma, {
      action: 'upi_credit.imported',
      entityType: 'upi_credit',
      entityId: null,
      userId,
      branchId,
      data: { rows: rows.length, added: created.count, skipped: rows.length - created.count, autoMatched: matched, batch },
    });
    return { added: created.count, skipped: rows.length - created.count, autoMatched: matched };
  }

  /** Match every open credit the rules can settle without a person. */
  async autoMatchOpen(branchId: number): Promise<number> {
    const open = await prisma.upiCredit.findMany({ where: { branchId, status: 'unmatched' } });
    if (open.length === 0) return 0;
    const times = open.map((c) => c.receivedAt.getTime());
    const from = new Date(Math.min(...times) - 2 * DAY_MS);
    const to = new Date(Math.max(...times) + 2 * DAY_MS);

    const [payments, pendings] = await Promise.all([
      prisma.payment.findMany({
        where: {
          method: 'upi',
          status: 'completed',
          upiCredit: null,
          createdAt: { gte: from, lte: to },
          sale: { branchId, status: { not: 'void' } },
        },
        select: { id: true, saleId: true, amount: true, referenceNumber: true, createdAt: true },
      }),
      prisma.pendingSale.findMany({
        where: { branchId, paymentMode: 'upi', status: 'pending', upiCredits: { none: {} }, createdAt: { gte: from, lte: to } },
        select: { id: true, amountReceived: true, createdAt: true },
      }),
    ]);

    const matches = autoMatch(
      open.map((c) => ({ id: c.id, amount: Number(c.amount), reference: c.reference, receivedAt: c.receivedAt })),
      payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      pendings.map((p) => ({ id: p.id, amount: Number(p.amountReceived), createdAt: p.createdAt }))
    );

    let count = 0;
    for (const m of matches) {
      // Conditional update: a credit a person matched meanwhile is left alone.
      const res = await prisma.upiCredit.updateMany({
        where: { id: m.creditId, status: 'unmatched' },
        data:
          m.kind === 'payment'
            ? { status: 'matched', matchedPaymentId: m.paymentId, matchedSaleId: m.saleId, matchMethod: m.method, resolvedAt: new Date() }
            : { status: 'matched', matchedPendingSaleId: m.pendingSaleId, matchMethod: m.method, resolvedAt: new Date() },
      }).catch((e: unknown) => {
        // A payment a concurrent match just claimed (unique) is left to that match.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { count: 0 };
        throw e;
      });
      count += res.count;
    }
    return count;
  }

  async list(branchId: number, status?: 'unmatched' | 'matched' | 'non_sale') {
    return prisma.upiCredit.findMany({
      where: { branchId, ...(status ? { status } : {}) },
      orderBy: { receivedAt: 'desc' },
      take: 300,
      include: creditInclude,
    });
  }

  async get(id: number, branchId: number) {
    const c = await prisma.upiCredit.findFirst({ where: { id, branchId }, include: creditInclude });
    if (!c) throw new AppError('UPI credit not found', 404);
    return c;
  }

  /** What a person might pair this credit with: same amount, near in time, still free. */
  async candidates(id: number, branchId: number) {
    const c = await this.get(id, branchId);
    const amount = Number(c.amount);
    const from = new Date(c.receivedAt.getTime() - 2 * DAY_MS);
    const to = new Date(c.receivedAt.getTime() + 2 * DAY_MS);
    const [payments, pendings] = await Promise.all([
      prisma.payment.findMany({
        where: {
          method: 'upi',
          status: 'completed',
          upiCredit: null,
          amount: { gte: amount - 1, lte: amount + 1 },
          createdAt: { gte: from, lte: to },
          sale: { branchId, status: { not: 'void' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          referenceNumber: true,
          sale: { select: { id: true, saleNumber: true, customer: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.pendingSale.findMany({
        where: { branchId, status: 'pending', upiCredits: { none: {} } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, number: true, amountReceived: true, paymentMode: true, createdAt: true },
      }),
    ]);
    return {
      credit: c,
      payments: payments.map((p) => ({
        paymentId: p.id,
        saleId: p.sale.id,
        saleNumber: p.sale.saleNumber,
        customer: p.sale.customer ? `${p.sale.customer.firstName} ${p.sale.customer.lastName ?? ''}`.trim() : null,
        amount: Number(p.amount),
        at: p.createdAt.toISOString(),
        reference: p.referenceNumber,
        exactAmount: Math.abs(Number(p.amount) - amount) < 0.005,
      })),
      pendingSales: pendings.map((p) => ({
        id: p.id,
        number: p.number,
        amount: Number(p.amountReceived),
        paymentMode: p.paymentMode,
        at: p.createdAt.toISOString(),
      })),
    };
  }

  async match(id: number, target: { paymentId?: number; pendingSaleId?: number }, userId: number, branchId: number) {
    const c = await this.get(id, branchId);
    if (c.status !== 'unmatched') throw new AppError('This credit is already accounted for', 409);
    let data: Prisma.UpiCreditUncheckedUpdateManyInput;
    if (target.paymentId) {
      const p = await prisma.payment.findFirst({
        where: { id: target.paymentId, sale: { branchId } },
        select: { id: true, saleId: true, upiCredit: { select: { id: true } } },
      });
      if (!p) throw new AppError('Payment not found', 404);
      if (p.upiCredit) throw new AppError('That payment is already matched to another credit', 409);
      data = { matchedPaymentId: p.id, matchedSaleId: p.saleId };
    } else if (target.pendingSaleId) {
      const ps = await prisma.pendingSale.findFirst({ where: { id: target.pendingSaleId, branchId } });
      if (!ps) throw new AppError('Pending sale not found', 404);
      if (ps.status === 'voided') throw new AppError('That pending sale was voided', 409);
      data = { matchedPendingSaleId: ps.id, matchedSaleId: ps.finalizedSaleId };
    } else {
      throw new AppError('Pick a bill or a pending sale to match', 400);
    }
    const res = await prisma.upiCredit.updateMany({
      where: { id, status: 'unmatched' },
      data: { ...data, status: 'matched', matchMethod: 'manual', resolvedBy: userId, resolvedAt: new Date() },
    });
    if (res.count === 0) throw new AppError('This credit was just matched by someone else', 409);
    await recordAudit(prisma, {
      action: 'upi_credit.matched',
      entityType: 'upi_credit',
      entityId: id,
      userId,
      branchId,
      data: { reference: c.reference, amount: Number(c.amount), ...target },
    });
    return this.get(id, branchId);
  }

  /** Money in that was never a sale: an owner top-up, a refund from a supplier. */
  async markNonSale(id: number, reason: string, userId: number, branchId: number) {
    const c = await this.get(id, branchId);
    if (c.status !== 'unmatched') throw new AppError('This credit is already accounted for', 409);
    await prisma.upiCredit.update({
      where: { id },
      data: { status: 'non_sale', nonSaleReason: reason.trim(), resolvedBy: userId, resolvedAt: new Date(), matchMethod: 'manual' },
    });
    await recordAudit(prisma, {
      action: 'upi_credit.non_sale',
      entityType: 'upi_credit',
      entityId: id,
      userId,
      branchId,
      reason: reason.trim(),
      data: { reference: c.reference, amount: Number(c.amount) },
    });
    return this.get(id, branchId);
  }

  /** Undo a match or a non-sale mark (a wrong pairing): back to unmatched. */
  async reopen(id: number, userId: number, branchId: number) {
    const c = await this.get(id, branchId);
    if (c.status === 'unmatched') return c;
    await prisma.upiCredit.update({
      where: { id },
      data: {
        status: 'unmatched',
        matchedPaymentId: null,
        matchedSaleId: null,
        matchedPendingSaleId: null,
        matchMethod: null,
        nonSaleReason: null,
        resolvedBy: null,
        resolvedAt: null,
      },
    });
    await recordAudit(prisma, {
      action: 'upi_credit.reopened',
      entityType: 'upi_credit',
      entityId: id,
      userId,
      branchId,
      data: { reference: c.reference, was: c.status },
    });
    return this.get(id, branchId);
  }
}

export const upiCreditService = new UpiCreditService();
