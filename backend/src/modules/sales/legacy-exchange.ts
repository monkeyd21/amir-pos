import prisma from '../../config/database';
import { recordAudit } from '../../services/audit';
import { posService } from '../pos/service';

/**
 * `POST /sales/:saleId/exchange`, kept for app builds already installed.
 *
 * This endpoint used to move the goods both ways and stop there: no bill for
 * the replacement, no record of the price difference the customer paid. The
 * piece walked out, the money went in the drawer, and neither existed on paper
 * (the very gap dashboard spec §15.5 is about). It now settles through the same
 * checkout the POS exchange uses: the replacement is a real bill, the returned
 * goods are a Return against the original, the one-exchange-per-bill rule and
 * its manager override apply exactly as at the till.
 *
 * The old screens never asked how the difference was paid, so it is recorded
 * as cash, said so on the bill, and audited. Current screens send the tender
 * to `POST /pos/checkout` themselves and never come here.
 */
export async function legacyExchange(
  saleId: number,
  body: {
    returnItems: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' }[];
    newItems: { barcode: string; quantity: number }[];
    reasonCode?: string | null;
    reason?: string | null;
    overrideGrant?: string | null;
  },
  userId: number,
  branchId: number
) {
  const base = {
    items: body.newItems.map((i) => ({ barcode: i.barcode, quantity: i.quantity })),
    exchange: {
      originalSaleId: saleId,
      returnItems: body.returnItems,
      reasonCode: body.reasonCode ?? null,
      reason: body.reason ?? null,
      overrideGrant: body.overrideGrant ?? undefined,
    },
    payments: [] as { method: string; amount: number }[],
  };

  const quote = await posService.quote(base, userId, branchId);
  const { sale, refund } = await posService.checkout(
    {
      ...base,
      payments: quote.amountDue > 0 ? [{ method: 'cash', amount: quote.amountDue }] : [],
      notes: 'Exchange from an older app: the difference was recorded as cash',
    },
    userId,
    branchId,
    { sessionOptional: true }
  );

  await recordAudit(prisma, {
    action: 'exchange.legacy_endpoint',
    entityType: 'sale',
    entityId: sale.id,
    userId,
    branchId,
    data: { originalSaleId: saleId, saleNumber: sale.saleNumber, amountDue: quote.amountDue, refundDue: refund },
  });

  const message =
    quote.amountDue > 0
      ? `Exchange billed as ${sale.saleNumber}. Customer paid ₹${quote.amountDue.toFixed(2)}`
      : refund > 0
      ? `Exchange billed as ${sale.saleNumber}. Refund ₹${refund.toFixed(2)} to the customer`
      : `Exchange billed as ${sale.saleNumber}. Even exchange`;
  return { sale, priceDifference: quote.amountDue - refund, refund, message };
}
