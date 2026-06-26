import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';
import { recordAudit } from '../../services/audit';

const round2 = (n: number) => Math.round(n * 100) / 100;

function generateVoucherCode(): string {
  // GV- + 8 hex chars. Collisions are astronomically unlikely; the unique
  // constraint is the real guard and create() retries on the rare clash.
  return `GV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export class VoucherService {
  async create(
    data: { value: number; expiresAt?: string | null; customerId?: number | null; notes?: string | null },
    userId: number,
    branchId: number
  ) {
    if (!(data.value > 0)) throw new AppError('Voucher value must be greater than 0', 400);

    // Retry a couple of times in the vanishingly rare case of a code collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateVoucherCode();
      try {
        const voucher = await prisma.giftVoucher.create({
          data: {
            code,
            initialValue: data.value,
            balance: data.value,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            customerId: data.customerId ?? null,
            branchId,
            issuedBy: userId,
            notes: data.notes ?? null,
          },
        });
        await recordAudit(prisma, {
          action: 'voucher.created',
          entityType: 'voucher',
          entityId: voucher.id,
          userId,
          branchId,
          data: { code: voucher.code, value: data.value, expiresAt: voucher.expiresAt },
        });
        return voucher;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new AppError('Could not allocate a unique voucher code, please retry', 500);
  }

  async list(query: { page?: string; limit?: string; status?: string; code?: string; customerId?: string }) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.GiftVoucherWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.code) where.code = { contains: query.code.toUpperCase() };
    if (query.customerId) where.customerId = parseInt(query.customerId, 10);

    const [rows, total] = await Promise.all([
      prisma.giftVoucher.findMany({
        where,
        include: { customer: { select: { firstName: true, lastName: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.giftVoucher.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta(page, limit, total) };
  }

  /** Lookup by code for redemption — reports an effective status so an expired
   *  voucher reads as 'expired' even if the row hasn't been swept yet. */
  async lookup(code: string) {
    const voucher = await prisma.giftVoucher.findUnique({
      where: { code: code.toUpperCase() },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });
    if (!voucher) throw new AppError('Voucher not found', 404);
    const expired = voucher.expiresAt ? voucher.expiresAt.getTime() < Date.now() : false;
    const effectiveStatus = expired && voucher.status === 'active' ? 'expired' : voucher.status;
    const redeemable = effectiveStatus === 'active' && Number(voucher.balance) > 0;
    return { ...voucher, effectiveStatus, redeemable };
  }

  async cancel(id: number, userId: number, branchId: number) {
    const voucher = await prisma.giftVoucher.findUnique({ where: { id } });
    if (!voucher) throw new AppError('Voucher not found', 404);
    if (voucher.status === 'cancelled') return voucher;
    const updated = await prisma.giftVoucher.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    await recordAudit(prisma, {
      action: 'voucher.cancelled',
      entityType: 'voucher',
      entityId: id,
      userId,
      branchId,
      data: { code: voucher.code, forfeitedBalance: Number(voucher.balance) },
    });
    return updated;
  }
}

/**
 * Redeem vouchers as a tender for a sale. Runs inside the checkout transaction.
 * Validates each voucher, debits its balance, logs a VoucherRedemption, and
 * returns the per-voucher amounts so the caller can record matching Payment
 * rows. Returns the total redeemed.
 */
export async function redeemVouchers(
  tx: Prisma.TransactionClient,
  vouchers: { code: string; amount: number }[],
  saleId: number,
  userId: number,
  branchId: number
): Promise<{ total: number; applied: { code: string; amount: number }[] }> {
  let total = 0;
  const applied: { code: string; amount: number }[] = [];
  const seen = new Set<string>();

  for (const v of vouchers) {
    const code = v.code.toUpperCase();
    if (seen.has(code)) throw new AppError(`Voucher ${code} listed twice`, 400);
    seen.add(code);
    const amount = round2(v.amount);
    if (!(amount > 0)) throw new AppError(`Voucher ${code} amount must be greater than 0`, 400);

    const voucher = await tx.giftVoucher.findUnique({ where: { code } });
    if (!voucher) throw new AppError(`Voucher ${code} not found`, 404);
    if (voucher.status !== 'active') throw new AppError(`Voucher ${code} is ${voucher.status}`, 400);
    if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
      await tx.giftVoucher.update({ where: { id: voucher.id }, data: { status: 'expired' } });
      throw new AppError(`Voucher ${code} has expired`, 400);
    }
    if (amount > Number(voucher.balance)) {
      throw new AppError(`Voucher ${code} balance is ${Number(voucher.balance)}, cannot redeem ${amount}`, 400);
    }

    const newBalance = round2(Number(voucher.balance) - amount);
    await tx.giftVoucher.update({
      where: { id: voucher.id },
      data: { balance: newBalance, status: newBalance <= 0 ? 'redeemed' : 'active' },
    });
    await tx.voucherRedemption.create({
      data: { voucherId: voucher.id, saleId, amount },
    });
    await recordAudit(tx, {
      action: 'voucher.redeemed',
      entityType: 'voucher',
      entityId: voucher.id,
      userId,
      branchId,
      data: { code, amount, saleId, balanceAfter: newBalance },
    });
    total = round2(total + amount);
    applied.push({ code, amount });
  }

  return { total, applied };
}

/**
 * Re-credit voucher value when a voucher-paid sale is returned. Distributes the
 * refunded voucher amount across the sale's redemptions (in proportion to what
 * each contributed) and bumps each voucher's balance back up, reactivating any
 * that had been fully redeemed. Logged as negative VoucherRedemption rows.
 */
export async function creditBackVouchers(
  tx: Prisma.TransactionClient,
  saleId: number,
  amount: number,
  userId: number,
  branchId: number
): Promise<void> {
  const refund = round2(amount);
  if (refund <= 0) return;

  const redemptions = await tx.voucherRedemption.findMany({
    where: { saleId, amount: { gt: 0 } },
  });
  const redeemedTotal = redemptions.reduce((s, r) => s + Number(r.amount), 0);
  if (redeemedTotal <= 0) return;

  let remaining = refund;
  for (let i = 0; i < redemptions.length; i++) {
    const r = redemptions[i];
    // Last row absorbs the rounding remainder so the credit sums exactly.
    const share =
      i === redemptions.length - 1
        ? remaining
        : round2((Number(r.amount) / redeemedTotal) * refund);
    remaining = round2(remaining - share);
    if (share <= 0) continue;

    const voucher = await tx.giftVoucher.findUnique({ where: { id: r.voucherId } });
    if (!voucher) continue;
    const creditable = Math.min(share, Number(voucher.initialValue) - Number(voucher.balance));
    if (creditable <= 0) continue;
    const newBalance = round2(Number(voucher.balance) + creditable);
    await tx.giftVoucher.update({
      where: { id: voucher.id },
      data: {
        balance: newBalance,
        status: voucher.status === 'redeemed' && newBalance > 0 ? 'active' : voucher.status,
      },
    });
    await tx.voucherRedemption.create({
      data: { voucherId: voucher.id, saleId, amount: -creditable },
    });
    await recordAudit(tx, {
      action: 'voucher.recredited',
      entityType: 'voucher',
      entityId: voucher.id,
      userId,
      branchId,
      data: { code: voucher.code, amount: creditable, saleId, balanceAfter: newBalance },
    });
  }
}

export const voucherService = new VoucherService();
