import { MovementType, PaymentMethod, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../../services/audit';
import { businessDateForUser } from '../../utils/business-date';
import { posService } from '../pos/service';
import { chargePrice } from '../pos/pricing';

/**
 * Dashboard spec §15.5: the "sold but not billed" gap.
 *
 * When staff hand a piece over and cannot (or should not) bill it, they scan
 * it here instead of writing it on paper. The stock comes off at once, so the
 * website cannot sell the same piece again; the owner later FINALISES it into
 * a real bill dated to the original trading day, or VOIDS it with a reason and
 * the stock goes back. Until finalised it is not a sale: no dashboard KPI
 * counts it (§12.1).
 *
 * Anyone may capture one. Only an owner or manager may see the list, finalise
 * or void.
 */

export interface CapturePendingInput {
  items: { barcode: string; quantity: number }[];
  paymentMode: 'cash' | 'upi';
  amountReceived: number;
  notes?: string | null;
  clientRef?: string | null;
}

export interface FinalizePendingInput {
  customerId?: number | null;
  /** Bill-level discount, if the owner agreed one with the customer. */
  discountAmount?: number;
  /** Defaults to the money the staff member recorded taking. */
  payments?: { method: string; amount: number; referenceNumber?: string }[];
  ownerPin?: string;
}

const include = {
  items: {
    include: {
      variant: { select: { id: true, barcode: true, sku: true, size: true, color: true, product: { select: { name: true } } } },
    },
  },
  creator: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PendingSaleInclude;

async function nextNumber(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.billSequence.upsert({
    where: { key: 'pending_sale' },
    create: { key: 'pending_sale', lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `PS${String(seq.lastNumber).padStart(4, '0')}`;
}

export class PendingSaleService {
  async capture(input: CapturePendingInput, userId: number, branchId: number) {
    if (input.clientRef) {
      const existing = await prisma.pendingSale.findUnique({ where: { clientRef: input.clientRef }, include });
      if (existing) return existing;
    }
    if (!input.items.length) throw new AppError('Scan at least one piece', 400);

    // Barcode only (§15.5): no free-text articles, so every pending sale names
    // exactly which pieces left the shop. SKU is accepted for old labels that
    // print it in place of a barcode, as the POS does.
    const codes = [...new Set(input.items.map((i) => i.barcode.trim()))];
    const variants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        OR: [{ barcode: { in: codes, mode: 'insensitive' } }, { sku: { in: codes, mode: 'insensitive' } }],
      },
      include: { product: true },
    });
    const byCode = new Map<string, (typeof variants)[number]>();
    for (const v of variants) {
      byCode.set(v.barcode.toLowerCase(), v);
      byCode.set(v.sku.toLowerCase(), v);
    }
    const missing = codes.filter((c) => !byCode.has(c.toLowerCase()));
    if (missing.length) throw new AppError(`Not found: ${missing.join(', ')}`, 400);

    const businessDate = await businessDateForUser(prisma, userId);

    try {
      return await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx);
        const pending = await tx.pendingSale.create({
          data: {
            branchId,
            number,
            businessDate,
            createdBy: userId,
            paymentMode: input.paymentMode as PaymentMethod,
            amountReceived: Math.round(input.amountReceived * 100) / 100,
            notes: input.notes?.trim() || null,
            clientRef: input.clientRef || null,
            items: {
              create: input.items.map((i) => {
                const v = byCode.get(i.barcode.trim().toLowerCase())!;
                return { variantId: v.id, quantity: i.quantity, tagPrice: chargePrice(v) };
              }),
            },
          },
          include,
        });

        // The stock comes off NOW, so the website cannot sell the piece again.
        for (const line of pending.items) {
          await tx.inventory.upsert({
            where: { variantId_branchId: { variantId: line.variantId, branchId } },
            update: { quantity: { decrement: line.quantity } },
            // The piece is physically gone even if the count never knew it existed.
            create: { variantId: line.variantId, branchId, quantity: -line.quantity },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: line.variantId,
              branchId,
              type: MovementType.sale,
              quantity: -line.quantity,
              referenceId: pending.id,
              referenceType: 'pending_sale',
              notes: `Pending sale ${number}`,
              createdBy: userId,
            },
          });
        }

        await recordAudit(tx, {
          action: 'pending_sale.captured',
          entityType: 'pending_sale',
          entityId: pending.id,
          userId,
          branchId,
          data: { number, amountReceived: input.amountReceived, paymentMode: input.paymentMode },
        });
        return pending;
      });
    } catch (e) {
      // Two syncs of the same offline capture raced: the other one won.
      if (input.clientRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await prisma.pendingSale.findUnique({ where: { clientRef: input.clientRef }, include });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async list(branchId: number, status: 'pending' | 'finalized' | 'voided' = 'pending') {
    return prisma.pendingSale.findMany({
      where: { branchId, status },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: 200,
      include,
    });
  }

  async get(id: number, branchId: number) {
    const p = await prisma.pendingSale.findFirst({ where: { id, branchId }, include });
    if (!p) throw new AppError('Pending sale not found', 404);
    return p;
  }

  /**
   * Turn the pending sale into a real bill through the ordinary checkout, so
   * the bill is priced, discounted, earns loyalty and settles exactly as any
   * other bill would. It is dated to the trading day the piece left the shop
   * (§12.1), and checkout leaves the stock alone (it already came off).
   */
  async finalize(id: number, input: FinalizePendingInput, userId: number, branchId: number) {
    const p = await this.get(id, branchId);
    if (p.status !== 'pending') throw new AppError(`Pending sale ${p.number} is already ${p.status}`, 409);

    const payments = input.payments?.length
      ? input.payments
      : [{ method: p.paymentMode, amount: Number(p.amountReceived) }];

    const { sale } = await posService.checkout(
      {
        items: p.items.map((i) => ({
          barcode: i.variant.barcode,
          quantity: i.quantity,
          // Whoever handed the piece over sold it.
          agentId: p.createdBy,
          attribution: 'counter' as const,
        })),
        customerId: input.customerId ?? undefined,
        discountAmount: input.discountAmount ?? 0,
        payments,
        ownerPin: input.ownerPin,
        clientRef: `pending-sale-${p.id}`,
        notes: `From pending sale ${p.number}`,
      },
      userId,
      branchId,
      { fromPendingSale: { id: p.id, businessDate: p.businessDate } }
    );

    await prisma.$transaction(async (tx) => {
      // Conditional update: two owners finalising at once cannot both win.
      const claimed = await tx.pendingSale.updateMany({
        where: { id: p.id, status: 'pending' },
        data: { status: 'finalized', finalizedSaleId: sale.id, finalizedBy: userId, finalizedAt: new Date() },
      });
      if (claimed.count === 0) throw new AppError(`Pending sale ${p.number} was finalised by someone else`, 409);
      // A UPI credit already matched to this pending sale now points at its bill.
      await tx.upiCredit.updateMany({ where: { matchedPendingSaleId: p.id }, data: { matchedSaleId: sale.id } });
      await recordAudit(tx, {
        action: 'pending_sale.finalized',
        entityType: 'pending_sale',
        entityId: p.id,
        userId,
        branchId,
        data: { number: p.number, saleId: sale.id, saleNumber: sale.saleNumber },
      });
    });

    return { pendingSale: await this.get(id, branchId), sale };
  }

  /** Nothing was sold after all: void with a reason and put the stock back. */
  async void(id: number, reason: string, userId: number, branchId: number) {
    const p = await this.get(id, branchId);
    if (p.status !== 'pending') throw new AppError(`Pending sale ${p.number} is already ${p.status}`, 409);
    if (!reason.trim()) throw new AppError('Say why it is being voided', 400);

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.pendingSale.updateMany({
        where: { id: p.id, status: 'pending' },
        data: { status: 'voided', voidReason: reason.trim(), voidedBy: userId, voidedAt: new Date() },
      });
      if (claimed.count === 0) throw new AppError(`Pending sale ${p.number} was already dealt with`, 409);
      for (const line of p.items) {
        await tx.inventory.upsert({
          where: { variantId_branchId: { variantId: line.variantId, branchId } },
          update: { quantity: { increment: line.quantity } },
          create: { variantId: line.variantId, branchId, quantity: line.quantity },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: line.variantId,
            branchId,
            type: MovementType.return,
            quantity: line.quantity,
            referenceId: p.id,
            referenceType: 'pending_sale',
            notes: `Pending sale ${p.number} voided`,
            createdBy: userId,
          },
        });
      }
      await tx.upiCredit.updateMany({
        where: { matchedPendingSaleId: p.id },
        data: { matchedPendingSaleId: null, status: 'unmatched', matchMethod: null, resolvedBy: null, resolvedAt: null },
      });
      await recordAudit(tx, {
        action: 'pending_sale.voided',
        entityType: 'pending_sale',
        entityId: p.id,
        userId,
        branchId,
        reason: reason.trim(),
        data: { number: p.number },
      });
    });
    return this.get(id, branchId);
  }
}

export const pendingSaleService = new PendingSaleService();
