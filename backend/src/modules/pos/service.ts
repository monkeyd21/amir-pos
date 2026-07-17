import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { generateNumber, isWithinPolicyWindow } from '../../utils/helpers';
import { EXCHANGE_WINDOW_DAYS } from '../sales/service';
import { MovementType, PaymentMethod, Prisma, SaleChannel } from '@prisma/client';
import { getPaymentGateway } from '../../services/payment-gateway';
import { evaluateCart as evaluateCartEngine, CartLine } from '../offers/engine';
import { getSetting } from '../settings/service';
import { reconcileCommissionsForSale } from '../../services/commission-reconcile';
import { redeemVouchers } from '../vouchers/service';
import { recordAudit } from '../../services/audit';
import { verifyOwnerPin } from '../../services/owner-pin';
import { gstRateForPrice } from '../../utils/tax';
import { createProduct as createProductService } from '../products/service';
import { slugify } from '../../utils/helpers';

/**
 * Atomically allocate the next human-friendly bill number for a channel
 * (W-0001 walk-in / O-0001 online). The counter row is keyed by the stable
 * channel name, so changing the display prefix in Settings never resets it.
 * Must run inside a transaction.
 */
async function nextBillNumber(
  tx: Prisma.TransactionClient,
  channel: SaleChannel
): Promise<string> {
  const cfg = await getSetting<{ walkin: string; online: string; pad: number }>(
    'billNumbering',
    { walkin: 'W', online: 'O', pad: 4 }
  );
  const seq = await tx.billSequence.upsert({
    where: { key: channel },
    create: { key: channel, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  const prefix = channel === 'online' ? cfg.online : cfg.walkin;
  // §bug12 — no hyphen: W0001 / O0001 (was W-0001 / O-0001).
  return `${prefix}${String(seq.lastNumber).padStart(cfg.pad ?? 4, '0')}`;
}

// §tz — the store trades in India. The server clock is UTC, so every trading-day
// calculation is done EXPLICITLY in IST (UTC+5:30, no DST) rather than relying on
// the server's local timezone. IST has no daylight saving, so a fixed offset is
// exact and future-proof.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// The India calendar day of `instant`, returned as a Date whose UTC Y/M/D equal
// the India-local Y/M/D (i.e. UTC-midnight of the India day). A Prisma `@db.Date`
// column stores only the UTC calendar date, so storing this value persists exactly
// the India trading day regardless of the server timezone. Reading it back (also
// UTC-midnight) and comparing to another value from this function is apples-to-apples.
function istBusinessDate(instant: Date): Date {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

// Current hour of day in IST (0–23) — used for the 4 am cutoff.
function istHour(instant: Date): number {
  return new Date(instant.getTime() + IST_OFFSET_MS).getUTCHours();
}

// Format a trading-day value (UTC-midnight of the India day) for display, e.g.
// "14 July 2026". Formatted in UTC because the stored value is UTC-midnight.
function formatBusinessDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// §11.0 — business date (trading day) for a shift, frozen at open. Every sale in
// the shift (including post-midnight ones) inherits it until the shift is closed.
function businessDateOf(session: { businessDate: Date | null; openedAt: Date }): Date {
  if (session.businessDate) {
    // Stored @db.Date reads back as UTC-midnight; take its UTC components verbatim.
    const d = session.businessDate;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  // Legacy sessions without a stored businessDate: derive the India day from openedAt.
  return istBusinessDate(session.openedAt);
}

// §bug9 — hard cutoff (IST hour) after which an unclosed prior-day shift blocks
// all POS activity until it is closed. 4 am per the spec.
const SHIFT_CUTOFF_HOUR = 4;

// §tax — GST is ALWAYS computed and stored on every sale (for GST records /
// GSTR-1), regardless of the `gstComplianceEnabled` setting. That setting is a
// pure DISPLAY switch: it only controls whether the stored GST is shown on
// bills, receipts and the P&L — it never changes what is recorded.

export class PosService {
  async openSession(userId: number, branchId: number, openingAmount: number, notes?: string) {
    // §bug9 — hard block: a new shift cannot open while a prior one is still open.
    // Name the unclosed shift's business date so the cashier knows exactly which
    // day to close first ("Aapne 13 July ki shift close nahi ki").
    const existing = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
    });

    if (existing) {
      const label = formatBusinessDate(businessDateOf(existing));
      throw new AppError(
        `You haven't closed the ${label} shift. Close it (enter the closing balance) before opening a new one.`,
        400
      );
    }

    // §11.0 — freeze the trading day at open. Today's India calendar date becomes
    // this shift's businessDate and stays fixed even if the shift runs past midnight.
    const businessDate = istBusinessDate(new Date());

    const session = await prisma.posSession.create({
      data: {
        branchId,
        userId,
        openingAmount,
        businessDate,
        notes,
      },
    });

    return session;
  }

  /**
   * §8.0 — suggested opening balance for the Day-Start screen: the closing
   * drawer balance of this user's most recently closed session (the float
   * typically carries forward). Falls back to 0 on the very first day.
   */
  async suggestedOpeningBalance(userId: number): Promise<number> {
    const last = await prisma.posSession.findFirst({
      where: { userId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
    });
    // §8.1a-8 — the deliberate closing float carries forward; fall back to the
    // physical count for sessions closed before the float field existed.
    if (last?.closingFloat != null) return Number(last.closingFloat);
    return last?.closingAmount != null ? Number(last.closingAmount) : 0;
  }

  /**
   * §8.1 — compute the three independent "System Expected" figures for the open
   * session: Cash (drawer), UPI (gateway), Card (machine). Each mode reconciles
   * against its own source of truth (§8.2) — never combined.
   */
  async closeSession(userId: number) {
    const session = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
    });

    if (!session) {
      throw new AppError('No open session found', 404);
    }

    // Sales this session grouped by tender method (incl. split-tender portions).
    const payAgg = await prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'completed',
        sale: { userId, createdAt: { gte: session.openedAt } },
      },
      _sum: { amount: true },
    });
    const salesByMethod: Record<string, number> = { cash: 0, upi: 0, card: 0 };
    for (const row of payAgg) {
      if (row.method in salesByMethod) salesByMethod[row.method] = Number(row._sum.amount || 0);
    }

    // §8.1 — refunds actually PAID OUT this session, keyed off the refund method
    // chosen (Return.refundBreakup), NOT the original sale's payment method. Per
    // §2.2b a cash sale can be refunded via UPI and vice versa, so each mode's
    // outflow must follow where the money really went.
    const returns = await prisma.return.findMany({
      where: { userId, createdAt: { gte: session.openedAt } },
      select: { refundBreakup: true },
    });
    const refundsByMethod: Record<string, number> = { cash: 0, upi: 0, card: 0 };
    for (const r of returns) {
      const breakup = (r.refundBreakup as { method: string; amount: number }[] | null) || [];
      for (const e of breakup) {
        if (e.method in refundsByMethod) refundsByMethod[e.method] += Number(e.amount) || 0;
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    // §8.1a-2 — cash: opening + cash sales − cash refunds (petty/drop are entered
    // at close and folded in there, not in this live preview).
    const expectedAmount = round2(Number(session.openingAmount) + salesByMethod.cash - refundsByMethod.cash);
    // §8.1b — UPI: UPI sales − UPI refunds.
    const expectedUpi = round2(salesByMethod.upi - refundsByMethod.upi);
    // §8.1c — Card: card sales only. Card is never a refund method (§2.2b), so no
    // refund subtraction and no card-refund field exists anywhere.
    const expectedCard = round2(salesByMethod.card);

    return { session, expectedAmount, expectedUpi, expectedCard };
  }

  async finalizeCloseSession(
    userId: number,
    data: {
      closingAmount: number;       // §8.1a-6 physical cash counted
      pettyCash?: number;
      pettyCashReason?: string;
      cashDrop?: number;
      closingFloat?: number;       // §8.1a-8 float left for tomorrow
      upiReceived?: number;        // §8.1b UPI settlement amount
      cardReceived?: number;       // §8.1c card settlement amount
      ownerPin?: string;
      cashVarianceReason?: string;
      upiVarianceReason?: string;
      cardVarianceReason?: string;
      // legacy aliases (older clients)
      managerPin?: string;
      varianceReason?: string;
      notes?: string;
    },
    branchId: number
  ) {
    const { session, expectedAmount, expectedUpi, expectedCard } = await this.closeSession(userId);

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const pettyCash = round2(data.pettyCash || 0);
    const cashDrop = round2(data.cashDrop || 0);
    const physical = round2(data.closingAmount);
    const closingFloat = data.closingFloat != null ? round2(data.closingFloat) : null;
    const upiReceived = round2(data.upiReceived || 0);
    const cardReceived = round2(data.cardReceived || 0);

    // §8.1a — System Expected Cash folds in petty + drop outflows; physical is
    // reconciled against that. Variance is signed: + short (missing), − over.
    const expectedCashNet = round2(expectedAmount - pettyCash - cashDrop);
    const cashVariance = round2(expectedCashNet - physical);
    const upiVariance = round2(expectedUpi - upiReceived);
    const cardVariance = round2(expectedCard - cardReceived);

    // §8.3 — single configurable threshold (default ₹50) applied uniformly and
    // INDEPENDENTLY to all three modes. |variance| ≥ threshold (inclusive) blocks
    // the close for THAT mode until Owner PIN + a reason for that mode.
    const threshold = Number(await getSetting<number>('varianceThreshold', 50));
    const ownerPin = data.ownerPin || data.managerPin;
    const cashReason = (data.cashVarianceReason || data.varianceReason || '').trim() || null;
    const upiReason = (data.upiVarianceReason || '').trim() || null;
    const cardReason = (data.cardVarianceReason || '').trim() || null;

    const modes = [
      { mode: 'cash', expected: expectedCashNet, actual: physical, variance: cashVariance, reason: cashReason },
      { mode: 'upi', expected: expectedUpi, actual: upiReceived, variance: upiVariance, reason: upiReason },
      { mode: 'card', expected: expectedCard, actual: cardReceived, variance: cardVariance, reason: cardReason },
    ];
    const breaches = modes.filter((m) => Math.abs(m.variance) >= threshold);

    if (breaches.length > 0) {
      const labels = breaches.map((b) => b.mode.toUpperCase()).join(', ');
      if (!ownerPin) {
        throw new AppError(
          `Variance ₹${threshold} or more in ${labels} — the Owner PIN and a reason for each affected mode are required to close`,
          400
        );
      }
      await verifyOwnerPin(ownerPin);
      const missing = breaches.filter((b) => !b.reason);
      if (missing.length > 0) {
        throw new AppError(
          `A reason is required for the ${missing.map((b) => b.mode.toUpperCase()).join(', ')} variance`,
          400
        );
      }
    }

    const pinAt = breaches.length > 0 ? new Date() : null;
    // §8.4 — the variance-log date is the shift's India trading day (8.0), stored
    // TZ-safe so a UTC server records it under the correct Indian date.
    const day = businessDateOf(session);

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.posSession.update({
        where: { id: session.id },
        data: {
          closingAmount: physical,
          expectedAmount,
          pettyCash,
          pettyCashReason: data.pettyCashReason || null,
          cashDrop,
          variance: cashVariance,
          varianceReason: cashReason,
          closingFloat,
          expectedUpi,
          upiReceived,
          upiVariance,
          upiVarianceReason: upiReason,
          expectedCard,
          cardReceived,
          cardVariance,
          cardVarianceReason: cardReason,
          status: 'closed',
          closedAt: new Date(),
          notes: data.notes || session.notes,
        },
      });

      // §8.4 — one row per mode per day. The report reads from this, never recalcs.
      await tx.varianceLog.createMany({
        data: modes.map((m) => {
          const gated = Math.abs(m.variance) >= threshold;
          return {
            branchId,
            sessionId: session.id,
            date: day,
            mode: m.mode,
            expected: m.expected,
            actual: m.actual,
            variance: m.variance,
            pinApproved: gated,
            reason: gated ? m.reason : null,
            pinApprovedAt: gated ? pinAt : null,
          };
        }),
      });

      return s;
    });

    await recordAudit(prisma, {
      action: 'pos.session.closed',
      entityType: 'pos_session',
      entityId: session.id,
      userId,
      branchId,
      data: {
        threshold,
        // §8.2 — stored separately per mode; never a combined total.
        cash: { expected: expectedCashNet, physical, variance: cashVariance },
        upi: { expected: expectedUpi, received: upiReceived, variance: upiVariance },
        card: { expected: expectedCard, received: cardReceived, variance: cardVariance },
        pinGated: breaches.map((b) => b.mode),
      },
    });

    return {
      ...updated,
      cashVariance,
      upiVariance,
      cardVariance,
      difference: round2(physical - expectedCashNet),
    };
  }

  async getCurrentSession(userId: number) {
    const session = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
      include: { branch: true },
    });

    return session || null;
  }

  async checkout(
    data: {
      items: { barcode: string; quantity: number; agentId?: number; nonReturnable?: boolean; discretionaryPct?: number }[];
      customerId?: number;
      channel?: 'walkin' | 'online';
      // Idempotency key (UUID). A repeat checkout with the same key returns the
      // original sale — the anti-duplicate guarantee for retries and offline sync.
      clientRef?: string;
      // Offline bill being synced: priced at MRP − manual discount only (no
      // offers/loyalty/exchange/voucher) and tolerant of stock going negative,
      // because the goods already physically left the counter.
      offline?: boolean;
      payments: { method: string; amount: number; referenceNumber?: string; identifier?: string }[];
      // Gift vouchers redeemed as a tender. Each covers part of the bill; the
      // balance is debited and a 'voucher' Payment row is recorded per voucher.
      vouchers?: { code: string; amount: number }[];
      discountAmount?: number;
      // §12 — special (flat) discount portion of discountAmount, kept separate
      // for the itemized bill breakup. Does not change totals.
      specialDiscount?: number;
      loyaltyPointsRedeem?: number;
      ownerPin?: string;
      notes?: string;
      exchange?: {
        originalSaleId: number;
        returnItems: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' }[];
        reason?: string;
      };
    },
    userId: number,
    branchId: number
  ) {
    const saleInclude = {
      items: { include: { variant: { include: { product: true } } } },
      payments: true,
      customer: true,
    } as const;

    // Idempotency fast-path: this bill was already recorded (e.g. an offline
    // sale re-synced, or a double-tapped checkout) — return it, don't re-create.
    if (data.clientRef) {
      const existing = await prisma.sale.findUnique({
        where: { clientRef: data.clientRef },
        include: saleInclude,
      });
      if (existing) return { sale: existing, change: 0, refund: 0, idempotent: true };
    }

    try {
      const result = await this._checkoutTxn(data, userId, branchId);
      return { ...result, idempotent: false };
    } catch (e) {
      // Lost a race on the unique clientRef — the winning request created it.
      if (
        data.clientRef &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await prisma.sale.findUnique({
          where: { clientRef: data.clientRef },
          include: saleInclude,
        });
        if (existing) return { sale: existing, change: 0, refund: 0, idempotent: true };
      }
      throw e;
    }
  }

  private async _checkoutTxn(
    data: {
      items: { barcode: string; quantity: number; agentId?: number; nonReturnable?: boolean; discretionaryPct?: number }[];
      customerId?: number;
      channel?: 'walkin' | 'online';
      clientRef?: string;
      offline?: boolean;
      payments: { method: string; amount: number; referenceNumber?: string; identifier?: string }[];
      vouchers?: { code: string; amount: number }[];
      discountAmount?: number;
      // §12 — special (flat) discount portion of discountAmount, kept separate
      // for the itemized bill breakup. Does not change totals.
      specialDiscount?: number;
      loyaltyPointsRedeem?: number;
      ownerPin?: string;
      notes?: string;
      exchange?: {
        originalSaleId: number;
        returnItems: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' }[];
        reason?: string;
      };
    },
    userId: number,
    branchId: number
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Verify user has an open session
      const session = await tx.posSession.findFirst({
        where: { userId, status: 'open' },
      });

      if (!session) {
        throw new AppError('No open POS session. Open a session before checkout.', 400);
      }

      // §bug9 — hard cutoff: if this shift belongs to an earlier trading day and
      // it's now past the 4 am cutoff, block further billing until it's closed.
      // (Before the cutoff, post-midnight peak-season billing continues normally.)
      const shiftDate = businessDateOf(session);
      const now = new Date();
      const todayDate = istBusinessDate(now);
      if (shiftDate.getTime() < todayDate.getTime() && istHour(now) >= SHIFT_CUTOFF_HOUR) {
        const label = formatBusinessDate(shiftDate);
        throw new AppError(
          `The ${label} shift is still open past ${SHIFT_CUTOFF_HOUR}:00 am. Close it (enter the closing balance) before billing again.`,
          400
        );
      }

      // 2. Resolve all barcodes to variants with product info
      const barcodes = data.items.map((i) => i.barcode);
      const variants = await tx.productVariant.findMany({
        where: { barcode: { in: barcodes }, isActive: true },
        include: {
          product: true,
        },
      });

      const variantByBarcode = new Map(variants.map((v) => [v.barcode, v]));

      // Validate all barcodes exist
      for (const item of data.items) {
        if (!variantByBarcode.has(item.barcode)) {
          throw new AppError(`Barcode not found: ${item.barcode}`, 400);
        }
      }

      // 3. Check stock availability for all items
      const saleItemsData: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        costPrice: number;
        taxRate: number;
        agentId: number | null;
        nonReturnable: boolean;
        discretionaryPct: number;
        isClearance: boolean;
      }> = [];

      // §2.3 — any line carrying an Owner Discretion Discount requires the Owner
      // PIN (online only; an offline bill replays the already-authorised pct).
      const hasDiscretionary = data.items.some((i) => (i.discretionaryPct ?? 0) > 0);
      if (!data.offline && hasDiscretionary) {
        await verifyOwnerPin(data.ownerPin);
      }

      for (const item of data.items) {
        const variant = variantByBarcode.get(item.barcode)!;

        const inventory = await tx.inventory.findUnique({
          where: {
            variantId_branchId: {
              variantId: variant.id,
              branchId,
            },
          },
        });

        // Offline bills already left the counter — record them even if stock
        // reads short (it may go negative; the count is reconciled later).
        if (!data.offline && (!inventory || inventory.quantity < item.quantity)) {
          throw new AppError(
            `Insufficient stock for ${variant.product.name} (${variant.size}/${variant.color}). Available: ${inventory?.quantity ?? 0}, Requested: ${item.quantity}`,
            400
          );
        }

        const costPrice = Number(variant.costOverride ?? variant.product.costPrice);
        const taxRate =
          Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
        // §2.4 — a clearance-flagged variant sells at its fixed clearancePrice
        // (final, tax-inclusive per §5) with ALL counter discounts locked and
        // the line auto-marked non-returnable. Otherwise use the normal price.
        const isClearance = variant.clearanceFlag && variant.clearancePrice != null;
        // §5/§13.3 — the customer is charged the MRP (final tax-inclusive) on a
        // normal line, or the fixed clearancePrice on a clearance line. The Sale
        // Price is display-only (barcode). Both branches return the final
        // tax-inclusive amount, so no further uplift is applied.
        const unitPrice = isClearance
          ? Number(variant.clearancePrice)
          : this.nonClearanceChargePrice(variant);

        saleItemsData.push({
          variantId: variant.id,
          quantity: item.quantity,
          unitPrice,
          costPrice,
          taxRate,
          agentId: item.agentId ?? userId, // default to cashier if no agent specified
          // §2.4 — clearance lines are always non-returnable, regardless of input.
          nonReturnable: isClearance ? true : item.nonReturnable === true,
          // Clamp defensively to the 15% ceiling; clearance locks it to 0.
          discretionaryPct: isClearance ? 0 : Math.min(15, Math.max(0, item.discretionaryPct ?? 0)),
          isClearance,
        });
      }

      // 4. Calculate totals
      const discountAmount = data.discountAmount || 0;
      let loyaltyDiscount = 0;

      // §9 — loyalty redemption works offline too. Single store, one customer
      // at a time (spec §10: "no conflict possible"), so the last-synced
      // balance is authoritative. Offline bills replay through here on
      // reconnect with offline=true; the balance/min-retained checks run
      // against the DB at sync time, and any shortfall surfaces as a sync
      // conflict rather than silently dropping the redemption.
      if (data.loyaltyPointsRedeem && data.loyaltyPointsRedeem > 0) {
        if (!data.customerId) {
          throw new AppError('Customer is required to redeem loyalty points', 400);
        }

        const customer = await tx.customer.findUnique({
          where: { id: data.customerId },
        });

        if (!customer) {
          throw new AppError('Customer not found', 404);
        }

        if (customer.loyaltyPoints < data.loyaltyPointsRedeem) {
          throw new AppError(
            `Insufficient loyalty points. Available: ${customer.loyaltyPoints}, Requested: ${data.loyaltyPointsRedeem}`,
            400
          );
        }

        // Get loyalty config for redemption value + minimum retained balance.
        // The customer must ALWAYS keep `minRedeem` points — only the excess is
        // redeemable (not "redeem all once you cross the threshold").
        const loyaltyConfig = await tx.loyaltyConfig.findFirst();
        const minRedeem = loyaltyConfig?.minRedeemPoints ?? 100;
        const redeemable = Math.max(0, customer.loyaltyPoints - minRedeem);
        if (data.loyaltyPointsRedeem > redeemable) {
          throw new AppError(
            redeemable === 0
              ? `No redeemable points — a minimum balance of ${minRedeem} must be kept (customer has ${customer.loyaltyPoints}).`
              : `Can redeem at most ${redeemable} points — a minimum balance of ${minRedeem} must be kept.`,
            400
          );
        }
        const redemptionValue = loyaltyConfig ? Number(loyaltyConfig.redemptionValue) : 1;
        loyaltyDiscount = data.loyaltyPointsRedeem * redemptionValue;
      }

      // 3b. Resolve offers server-side (never trust the client). Offline bills
      // are priced at MRP − manual discount only, so the total the customer was
      // charged offline matches exactly what's recorded on sync (no offer drift).
      const cartLines: CartLine[] = saleItemsData.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      }));
      const evaluated = data.offline ? [] : await evaluateCartEngine(cartLines);
      const offerByVariantId = new Map<
        number,
        { offerId: number; discount: number; effectiveUnitPrice: number }
      >();
      // §2.4 — clearance variants never take an offer (price is locked).
      const clearanceVariantIds = new Set(
        saleItemsData.filter((i) => i.isClearance).map((i) => i.variantId)
      );
      for (const e of evaluated) {
        if (e.offer && e.result?.qualified && !clearanceVariantIds.has(e.line.variantId)) {
          offerByVariantId.set(e.line.variantId, {
            offerId: e.offer.id,
            discount: e.result.discountAmount,
            effectiveUnitPrice: e.result.effectiveUnitPrice,
          });
        }
      }

      // ─── Tax-inclusive pricing (Indian clothing retail MRP convention) ───
      //
      // Product prices on hang-tags and in the database are the MRP — the
      // tax is ALREADY baked into the price the customer sees. When we
      // compute line totals we must NOT add tax on top; we must EXTRACT the
      // tax component from within the inclusive amount.
      //
      //   net  = inclusive / (1 + rate/100)
      //   tax  = inclusive - net  =  inclusive × rate / (100 + rate)
      //
      // Example: ₹1180 shelf price at 18% GST → ₹1000 net + ₹180 tax,
      //          and the customer still pays ₹1180 (not ₹1180 + 180).
      //
      // Sale.subtotal is kept as the "gross sum of shelf prices" (pre-
      // discount, tax-inclusive) to preserve reporting semantics —
      // dashboards and the sale detail page show it as the list-price
      // total that the customer saw. Sale.taxAmount stores the extracted
      // GST component for GSTR-1 filings. Sale.total = what the customer
      // actually paid = subtotal − discounts (no tax added on top).
      // Pass 1: gather per-line gross + offer discount. We can't compute tax
      // yet because manual/loyalty discounts still need to be apportioned.
      interface LineAccumulator {
        variantId: number;
        quantity: number;
        unitPrice: number;
        taxRate: number;
        lineGross: number;
        offerDiscount: number;
        discretionaryDiscount: number;
        discretionaryPct: number;
        offerId: number | null;
        effectiveUnitPrice: number | null;
        agentId: number | null;
        nonReturnable: boolean;
        isClearance: boolean;
      }
      const lines: LineAccumulator[] = [];
      let subtotal = 0;
      let totalOfferDiscount = 0;
      let totalDiscretionaryDiscount = 0;

      for (const item of saleItemsData) {
        const lineGross = item.unitPrice * item.quantity;
        const offerInfo = offerByVariantId.get(item.variantId);
        const offerDiscount = offerInfo?.discount ?? 0;
        // §2.3 — discretionary discount is a % of the line's gross (own top-up,
        // separate from item/special/offer discounts per the owner decision).
        const discretionaryDiscount =
          Math.round(lineGross * (item.discretionaryPct / 100) * 100) / 100;
        lines.push({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          lineGross,
          offerDiscount,
          discretionaryDiscount,
          discretionaryPct: item.discretionaryPct,
          offerId: offerInfo?.offerId ?? null,
          effectiveUnitPrice: offerInfo?.effectiveUnitPrice ?? null,
          agentId: item.agentId,
          nonReturnable: item.nonReturnable,
          isClearance: item.isClearance,
        });
        subtotal += lineGross;
        totalOfferDiscount += offerDiscount;
        totalDiscretionaryDiscount += discretionaryDiscount;
      }

      subtotal = Math.round(subtotal * 100) / 100;
      totalOfferDiscount = Math.round(totalOfferDiscount * 100) / 100;
      totalDiscretionaryDiscount = Math.round(totalDiscretionaryDiscount * 100) / 100;

      // Apportion manual + loyalty discounts proportionally across lines,
      // weighted by each line's post-offer taxable value. This way the
      // extracted GST reflects what the customer ACTUALLY paid per line
      // after all discount stacking — critical for GSTR-1 accuracy when
      // tax is inclusive. If the non-offer discount exceeds the post-offer
      // taxable base, we clamp per-line adjustments to zero.
      const nonOfferDiscount = discountAmount + loyaltyDiscount;
      // Apportion over what's left after BOTH offer and discretionary discounts.
      // §2.4a/§2.4b — clearance lines are EXCLUDED from the base: their price is
      // fixed, so bill-level manual/loyalty discounts attach only to non-clearance
      // lines (and clearance lines get zero apportioned share in Pass 2).
      const postOfferTaxableTotal = lines.reduce(
        (s, l) => (l.isClearance ? s : s + (l.lineGross - l.offerDiscount - l.discretionaryDiscount)),
        0
      );
      const apportionRatio =
        postOfferTaxableTotal > 0
          ? Math.min(1, nonOfferDiscount / postOfferTaxableTotal)
          : 0;

      // Pass 2: compute per-line taxable + tax with the apportioned discount.
      let totalTax = 0;
      const itemsForCreation: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxAmount: number;
        total: number;
        offerId?: number | null;
        effectiveUnitPrice?: number | null;
        agentId?: number | null;
        nonReturnable?: boolean;
        ownerDiscretionDiscount?: number;
      }> = [];

      for (const line of lines) {
        const postOffer = line.lineGross - line.offerDiscount - line.discretionaryDiscount;
        // §2.4a — clearance lines take no share of bill-level manual/loyalty.
        const apportioned = line.isClearance
          ? 0
          : Math.round(postOffer * apportionRatio * 100) / 100;
        const lineTaxable = postOffer - apportioned;
        // §gst — dynamic rate on the per-unit charged (post-discount, inclusive)
        // price: ≤ ₹2,500 → 5%, else 18%. Extract the GST from within the amount.
        const gstRate = gstRateForPrice(line.quantity > 0 ? lineTaxable / line.quantity : lineTaxable);
        const lineTax = lineTaxable * (gstRate / (100 + gstRate));
        // Customer pays the inclusive taxable — no tax added on top.
        const lineTotal = lineTaxable;
        // `discount` is the total per-line reduction; the discretionary slice is
        // ALSO stored separately (ownerDiscretionDiscount) for the breakup/report.
        const lineDiscountTotal = line.offerDiscount + line.discretionaryDiscount + apportioned;

        totalTax += lineTax;

        itemsForCreation.push({
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: Math.round(lineDiscountTotal * 100) / 100,
          taxAmount: Math.round(lineTax * 100) / 100,
          total: Math.round(lineTotal * 100) / 100,
          offerId: line.offerId,
          effectiveUnitPrice: line.effectiveUnitPrice,
          agentId: line.agentId,
          nonReturnable: line.nonReturnable,
          ownerDiscretionDiscount: line.discretionaryDiscount,
        });
      }

      totalTax = Math.round(totalTax * 100) / 100;
      // Sale.subtotal stays as the "gross shelf total" for reporting so the
      // receipt can show "MRP total / less discount / you pay".
      // Sale.total is what the customer actually pays — tax is already inside
      // subtotal, so we just subtract all discounts.
      const totalDiscount =
        discountAmount + loyaltyDiscount + totalOfferDiscount + totalDiscretionaryDiscount;
      const saleTotal = Math.round((subtotal - totalDiscount) * 100) / 100;

      // §bug7 — surface the EXACT reason a discount validation fails instead of a
      // generic "Discount exceeds sale total". First reject an invalid special
      // discount specifically (kept ≥ 0), then, if the combined discounts blow
      // past the bill, spell out every component and by how much it overshot.
      const specialDiscount = Math.round((data.specialDiscount || 0) * 100) / 100;
      const manualDiscount = Math.round((discountAmount - specialDiscount) * 100) / 100;
      if (specialDiscount < 0) {
        throw new AppError(
          `Special discount cannot be negative (got ₹${specialDiscount.toFixed(2)}). Enter 0 or a positive amount.`,
          400
        );
      }
      if (saleTotal < 0) {
        const parts = [
          `manual ₹${manualDiscount.toFixed(2)}`,
          `special ₹${specialDiscount.toFixed(2)}`,
          `loyalty ₹${loyaltyDiscount.toFixed(2)}`,
          `offers ₹${totalOfferDiscount.toFixed(2)}`,
          `owner discretion ₹${totalDiscretionaryDiscount.toFixed(2)}`,
        ].filter((p) => !p.endsWith('₹0.00'));
        throw new AppError(
          `Total discount ₹${totalDiscount.toFixed(2)} (${parts.join(' + ')}) exceeds the bill of ₹${subtotal.toFixed(2)} by ₹${Math.abs(saleTotal).toFixed(2)}. Reduce a discount so the payable stays at or above ₹0.`,
          400
        );
      }

      // 4b. Exchange — return goods from a prior sale and credit the value
      // against THIS purchase. The returned items are restocked and a Return
      // record is created here, inside the same transaction as the new sale,
      // so the swap is atomic. The new sale keeps its full value (correct GST);
      // the customer only pays (saleTotal − exchangeCredit).
      let exchangeCredit = 0;
      let exchangeReturnId: number | null = null;
      let exchangeOriginalNumber: string | null = null;

      if (data.exchange && !data.offline) {
        const orig = await tx.sale.findUnique({
          where: { id: data.exchange.originalSaleId },
          include: { items: { include: { variant: { include: { product: true } } } } },
        });
        if (!orig) throw new AppError('Original sale for the exchange was not found', 404);
        if (orig.status === 'void') throw new AppError('Cannot exchange against a voided sale', 400);
        // §1.5 — exchanges must fall inside the exchange policy window.
        if (!isWithinPolicyWindow(orig.createdAt, EXCHANGE_WINDOW_DAYS)) {
          throw new AppError(
            `Exchange window of ${EXCHANGE_WINDOW_DAYS} days has passed for ${orig.saleNumber}`,
            400
          );
        }
        exchangeOriginalNumber = orig.saleNumber;

        const origItems = new Map(orig.items.map((i) => [i.id, i]));
        let returnSubtotal = 0;
        let returnTax = 0;
        const restock: Array<{
          saleItemId: number;
          variantId: number;
          quantity: number;
          unitPrice: number;
          condition: 'resellable' | 'damaged';
        }> = [];

        for (const ri of data.exchange.returnItems) {
          const si = origItems.get(ri.saleItemId);
          if (!si) {
            throw new AppError(`Return item ${ri.saleItemId} is not part of sale ${orig.saleNumber}`, 400);
          }
          // A line marked non-returnable at billing (or a non-returnable product)
          // can't come back through an exchange either — an exchange can net a
          // cash refund, which would bypass the block.
          if ((si as any).nonReturnable || si.variant?.product?.nonReturnable) {
            const nm = si.variant?.product?.name ?? `item ${si.id}`;
            throw new AppError(`${nm} is marked non-returnable and cannot be exchanged`, 400);
          }
          const available = si.quantity - si.returnedQuantity;
          if (ri.quantity > available) {
            throw new AppError(
              `Cannot return ${ri.quantity} of that line — only ${available} left to return.`,
              400
            );
          }
          // Credit the price the customer ACTUALLY paid per unit. SaleItem.total
          // nets out every discount — the offer AND the apportioned bill-level
          // manual discount AND loyalty — so (total / quantity) is the true paid
          // amount. (effectiveUnitPrice only reflected offers, so a manually
          // discounted item was over-credited at near-MRP — the 4k-vs-3.6k bug.)
          const unit = Number(si.total) / si.quantity;
          returnSubtotal += unit * ri.quantity;
          returnTax += (Number(si.taxAmount) / si.quantity) * ri.quantity;
          restock.push({
            saleItemId: si.id,
            variantId: si.variantId,
            quantity: ri.quantity,
            unitPrice: unit,
            condition: ri.condition,
          });
        }

        exchangeCredit = Math.round(returnSubtotal * 100) / 100;

        const returnNumber = generateNumber('RT');
        const returnRecord = await tx.return.create({
          data: {
            originalSaleId: orig.id,
            branchId,
            userId,
            returnNumber,
            type: 'exchange',
            reason: data.exchange.reason || 'Exchange at POS',
            subtotal: exchangeCredit,
            taxAmount: Math.round(returnTax * 100) / 100,
            total: exchangeCredit,
            status: 'completed',
            items: {
              create: restock.map((r) => ({
                saleItemId: r.saleItemId,
                variantId: r.variantId,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
                condition: r.condition,
              })),
            },
          },
        });
        exchangeReturnId = returnRecord.id;

        for (const r of restock) {
          await tx.saleItem.update({
            where: { id: r.saleItemId },
            data: { returnedQuantity: { increment: r.quantity } },
          });
          if (r.condition === 'resellable') {
            await tx.inventory.upsert({
              where: { variantId_branchId: { variantId: r.variantId, branchId } },
              update: { quantity: { increment: r.quantity } },
              create: { variantId: r.variantId, branchId, quantity: r.quantity },
            });
            await tx.inventoryMovement.create({
              data: {
                variantId: r.variantId,
                branchId,
                type: MovementType.return,
                quantity: r.quantity,
                referenceId: returnRecord.id,
                referenceType: 'return',
                createdBy: userId,
              },
            });
          }
        }

        // Roll the original sale's status forward.
        const updated = await tx.saleItem.findMany({ where: { saleId: orig.id } });
        const allReturned = updated.every((i) => i.returnedQuantity >= i.quantity);
        const someReturned = updated.some((i) => i.returnedQuantity > 0);
        await tx.sale.update({
          where: { id: orig.id },
          data: {
            status: allReturned ? 'returned' : someReturned ? 'partially_returned' : orig.status,
          },
        });

        // Returned goods reduce the original sale's value — re-settle commission.
        await reconcileCommissionsForSale(tx, orig.id, userId, branchId);
      }

      // net = new purchase − return credit. Positive ⇒ customer pays the
      // difference; negative ⇒ the shop refunds the customer the difference.
      const netPayable = Math.round((saleTotal - exchangeCredit) * 100) / 100;
      const amountDue = Math.max(0, netPayable);
      const refundDue = Math.max(0, Math.round(-netPayable * 100) / 100);

      // 5. Validate tenders cover what the customer owes. Gift vouchers are a
      // tender too: they cover part of amountDue, so the cash/card/UPI only
      // needs to cover the rest. A voucher can't exceed the bill (no cash back),
      // and the actual balance debit happens after the sale is created.
      const voucherRequests = data.offline ? [] : (data.vouchers ?? []).filter((v) => v.amount > 0);
      const voucherTotal = Math.round(voucherRequests.reduce((s, v) => s + v.amount, 0) * 100) / 100;
      if (voucherTotal > amountDue + 0.0001) {
        throw new AppError(
          `Voucher amount ${voucherTotal} exceeds the payable ${amountDue}. Gift vouchers don't return cash.`,
          400
        );
      }
      const cashDue = Math.max(0, Math.round((amountDue - voucherTotal) * 100) / 100);
      const totalPayments = data.payments.reduce((sum, p) => sum + p.amount, 0);

      if (totalPayments < cashDue) {
        throw new AppError(
          `Payment shortfall. Payable: ${cashDue}, Paid: ${totalPayments}`,
          400
        );
      }

      // 6. Validate customer exists if provided
      if (data.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: data.customerId },
        });
        if (!customer) {
          throw new AppError('Customer not found', 404);
        }
      }

      // 7. Create the sale
      const channel: SaleChannel = data.channel === 'online' ? 'online' : 'walkin';
      const saleNumber = await nextBillNumber(tx, channel);

      const sale = await tx.sale.create({
        data: {
          branchId,
          userId,
          customerId: data.customerId || null,
          saleNumber,
          channel,
          clientRef: data.clientRef || null,
          // §11.0 — roll this sale up into the open shift's trading day, not the
          // wall-clock date. createdAt still records the real time (printed on the bill).
          businessDate: businessDateOf(session),
          subtotal,
          taxAmount: totalTax,
          discountAmount: totalDiscount,
          // §12 breakup — split the consolidated discount for the Sales detail view.
          // `data.discountAmount` already includes the special discount; subtract it
          // out to recover the manual (+ round-off) portion.
          specialDiscountAmount: data.specialDiscount || 0,
          manualDiscountAmount: Math.max(0, (data.discountAmount || 0) - (data.specialDiscount || 0)),
          loyaltyDiscountAmount: loyaltyDiscount,
          total: saleTotal,
          loyaltyPointsRedeemed: data.loyaltyPointsRedeem || 0,
          exchangeCreditAmount: exchangeCredit,
          exchangeReturnId,
          notes: exchangeOriginalNumber
            ? `${data.notes ? data.notes + ' | ' : ''}Exchange credit ₹${exchangeCredit.toFixed(2)} vs ${exchangeOriginalNumber}`
            : data.notes,
          items: {
            create: itemsForCreation,
          },
          payments: {
            create: data.payments.map((p) => ({
              method: p.method as PaymentMethod,
              amount: p.amount,
              referenceNumber: p.referenceNumber,
              identifier: p.identifier,
            })),
          },
        },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
          payments: true,
          customer: true,
        },
      });

      // §2.3 — log every Owner Discretion Discount for the monthly review
      // report: bill, customer, terminal user, % granted, and ₹ amount.
      if (hasDiscretionary) {
        for (const line of lines) {
          if (line.discretionaryDiscount > 0) {
            await recordAudit(tx, {
              action: 'sale.discretionaryDiscount',
              entityType: 'sale',
              entityId: sale.id,
              userId,
              branchId,
              data: {
                saleNumber: sale.saleNumber,
                customerId: data.customerId ?? null,
                variantId: line.variantId,
                pct: line.discretionaryPct,
                amount: line.discretionaryDiscount,
              },
            });
          }
        }
      }

      // 7b. Redeem gift vouchers as a tender: debit balances, log redemptions,
      // and record matching 'voucher' Payment rows so sale.payments sum to the
      // bill total (keeps reporting and the proportional-refund split consistent).
      if (voucherRequests.length > 0) {
        const { applied } = await redeemVouchers(tx, voucherRequests, sale.id, userId, branchId, sale.customerId);
        for (const v of applied) {
          await tx.payment.create({
            data: {
              saleId: sale.id,
              method: 'voucher' as PaymentMethod,
              amount: v.amount,
              referenceNumber: v.code,
            },
          });
        }
      }

      // 8. Deduct inventory and create movement records
      for (const item of saleItemsData) {
        await tx.inventory.update({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId,
            type: MovementType.sale,
            quantity: -item.quantity,
            referenceId: sale.id,
            referenceType: 'sale',
            createdBy: userId,
          },
        });
      }

      // 9. Update customer if provided
      if (data.customerId) {
        // Calculate loyalty points earned
        const loyaltyConfig = await tx.loyaltyConfig.findFirst();
        let pointsEarned = 0;

        if (loyaltyConfig) {
          const customer = await tx.customer.findUnique({
            where: { id: data.customerId },
          });

          const multipliers = loyaltyConfig.earningMultipliers as Record<string, number>;
          const multiplier = customer ? (multipliers[customer.loyaltyTier] || 1) : 1;
          const pointsPer = loyaltyConfig.pointsPerAmount;
          const amountPer = loyaltyConfig.amountPerPoint;

          // Earn on what the customer actually paid (net of any exchange
          // credit) so a swap doesn't hand out points for value returned.
          pointsEarned = Math.floor((Math.max(0, netPayable) / amountPer) * pointsPer * multiplier);
        }

        // Deduct redeemed points and add earned points
        const pointsDelta = pointsEarned - (data.loyaltyPointsRedeem || 0);

        await tx.customer.update({
          where: { id: data.customerId },
          data: {
            visitCount: { increment: 1 },
            totalSpent: { increment: Math.max(0, netPayable) },
            loyaltyPoints: { increment: pointsDelta },
          },
        });

        // Update sale with loyalty points earned
        await tx.sale.update({
          where: { id: sale.id },
          data: { loyaltyPointsEarned: pointsEarned },
        });

        // Create loyalty transactions
        if (pointsEarned > 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: data.customerId,
              saleId: sale.id,
              points: pointsEarned,
              type: 'earned',
              description: `Points earned from sale ${saleNumber}`,
            },
          });
        }

        if (data.loyaltyPointsRedeem && data.loyaltyPointsRedeem > 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: data.customerId,
              saleId: sale.id,
              points: -data.loyaltyPointsRedeem,
              type: 'redeemed',
              description: `Points redeemed on sale ${saleNumber}`,
            },
          });
        }

        sale.loyaltyPointsEarned = pointsEarned;
      }

      // 10. Calculate change — against the cash-side due (after vouchers), so an
      // overpayment in cash returns the right change and vouchers give no cash back.
      const change = Math.round((totalPayments - cashDue) * 100) / 100;

      return { sale, change, refund: refundDue };
    });
  }

  /**
   * Evaluate a cart against the offers engine. For each line, returns:
   *   - the resolved offer (variant-level preferred over product-level)
   *   - computed discount + effective unit price + qualification hint
   *   - the base unit price that was used
   */
  async evaluateCart(items: { variantId: number; quantity: number }[]) {
    const variantIds = items.map((i) => i.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    // §2.4 — a clearance line prices at its fixed clearancePrice and takes NO
    // offer. §5/§13.3 — a normal line is charged the MRP. Resolve each line's
    // price + clearance flag up front.
    const meta = items.map((i) => {
      const v = variantMap.get(i.variantId);
      if (!v) {
        throw new AppError(`Variant ${i.variantId} not found`, 404);
      }
      const isClearance = v.clearanceFlag && v.clearancePrice != null;
      const unitPrice = isClearance
        ? Number(v.clearancePrice)
        : this.nonClearanceChargePrice(v);
      return { variantId: i.variantId, quantity: i.quantity, unitPrice, isClearance };
    });

    // Only NON-clearance lines are evaluated by the offer engine — clearance
    // lines must never qualify for (or influence, e.g. BOGO) any offer.
    const dutiable: CartLine[] = meta
      .filter((m) => !m.isClearance)
      .map(({ variantId, quantity, unitPrice }) => ({ variantId, quantity, unitPrice }));
    const evaluated = await evaluateCartEngine(dutiable);
    const evalMap = new Map(evaluated.map((e) => [e.line.variantId, e]));

    return meta.map((m) => {
      // Clearance line: locked price, no offer.
      if (m.isClearance) {
        return {
          variantId: m.variantId,
          quantity: m.quantity,
          unitPrice: m.unitPrice,
          offer: null,
          qualified: false,
          discountAmount: 0,
          effectiveUnitPrice: m.unitPrice,
          lineTotal: m.unitPrice * m.quantity,
          hint: undefined,
          clearance: true,
        };
      }
      const e = evalMap.get(m.variantId);
      const offer = e?.offer;
      const result = e?.result;
      return {
        variantId: m.variantId,
        quantity: m.quantity,
        unitPrice: m.unitPrice,
        offer: offer
          ? {
              id: offer.id,
              name: offer.name,
              type: offer.type,
              displayText: result?.displayText ?? '',
            }
          : null,
        qualified: result?.qualified ?? false,
        discountAmount: result?.discountAmount ?? 0,
        effectiveUnitPrice: result?.effectiveUnitPrice ?? 0,
        lineTotal: result?.lineTotal ?? m.unitPrice * m.quantity,
        hint: result?.hint,
        clearance: false,
      };
    });
  }

  /**
   * Catalog snapshot for offline caching. Returns every active variant with the
   * barcode, tax-inclusive MRP, tax rate and current branch stock — everything
   * the terminal needs to scan and price a bill with no network. The `price`
   * here matches exactly what checkout computes (offline pricing is MRP-only),
   * so an offline bill totals the same on the device and on sync.
   */
  async getCatalog(branchId: number) {
    // §4.3 — quantities soft-reserved by active (non-expired) held bills, so the
    // catalog can show stock as "on hold" rather than freely available.
    const holds = await prisma.heldTransaction.findMany({
      where: { branchId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { cartData: true },
    });
    const reserved = new Map<number, number>();
    for (const h of holds) {
      const lines = (h.cartData as any)?.cart;
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        const vid = Number(line?.variantId);
        const qty = Number(line?.quantity);
        if (vid && qty > 0) reserved.set(vid, (reserved.get(vid) ?? 0) + qty);
      }
    }

    const variants = await prisma.productVariant.findMany({
      where: { isActive: true },
      include: { product: true, inventory: { where: { branchId } } },
    });
    const items = variants.map((v) => {
      // §5/§13.3 — offline POS charges the MRP too (clearance overrides).
      const isClearance = v.clearanceFlag && v.clearancePrice != null;
      const price = isClearance ? Number(v.clearancePrice) : this.nonClearanceChargePrice(v);
      const taxRate = gstRateForPrice(price); // §gst — dynamic rate on the charged price
      return {
        variantId: v.id,
        barcode: v.barcode,
        sku: v.sku,
        productName: v.product.name,
        size: v.size,
        color: v.color,
        price,
        clearance: isClearance,
        taxRate,
        stock: v.inventory[0]?.quantity ?? 0,
        // §4.3 — soft reservation: held quantity + what's freely sellable.
        reserved: reserved.get(v.id) ?? 0,
        available: Math.max(0, (v.inventory[0]?.quantity ?? 0) - (reserved.get(v.id) ?? 0)),
      };
    });
    return { items, syncedAt: new Date().toISOString(), count: items.length };
  }

  /**
   * Case B "ghost product": an item is physically in hand but has no record at
   * all (barcode/SKU doesn't resolve). Create a minimal product + one variant +
   * initial stock in one shot so the sale isn't blocked, then return it in the
   * SAME shape as lookupBarcode so the POS can drop it straight into the cart.
   * Category drives HSN + dynamic GST automatically (via createProduct).
   */
  async quickCreateProduct(
    data: {
      name: string;
      categoryId?: number | null;
      brandId?: number | null;
      mrp: number;
      size?: string | null;
      color?: string | null;
      quantity: number;
    },
    userId: number,
    branchId: number
  ) {
    const name = (data.name || '').trim();
    if (!name) throw new AppError('Product name is required', 400);
    const mrp = Number(data.mrp);
    if (!(mrp > 0)) throw new AppError('A valid MRP is required', 400);
    const qty = Math.max(1, Math.floor(Number(data.quantity) || 1));

    const categoryId = data.categoryId ?? (await this.ensureDefaultCategory());
    const brandId = data.brandId ?? (await this.ensureDefaultBrand());

    const product = await createProductService(
      {
        name,
        brandId,
        categoryId,
        mrp,
        basePrice: Math.round(mrp * 0.9), // §13.3 — Sale = MRP − 10%
        costPrice: 0,
        variants: [
          {
            size: (data.size || '').trim(),
            color: (data.color || '').trim(),
            initialStock: qty,
          },
        ],
      },
      userId,
      branchId
    );

    // Re-fetch through the normal lookup so the POS gets an identical payload.
    return this.lookupBarcode(product.variants[0].barcode, branchId);
  }

  private async ensureDefaultBrand(): Promise<number> {
    const existing = await prisma.brand.findFirst({ where: { name: 'General' } });
    if (existing) return existing.id;
    const created = await prisma.brand.create({ data: { name: 'General', slug: slugify('General') } });
    return created.id;
  }

  private async ensureDefaultCategory(): Promise<number> {
    const existing = await prisma.category.findFirst({ where: { name: 'Uncategorized' } });
    if (existing) return existing.id;
    const created = await prisma.category.create({
      data: { name: 'Uncategorized', slug: slugify('Uncategorized') },
    });
    return created.id;
  }

  async lookupBarcode(barcode: string, branchId: number) {
    const variant = await prisma.productVariant.findFirst({
      where: { barcode, isActive: true },
      include: {
        product: {
          include: {
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!variant) {
      throw new AppError('Product not found for this barcode', 404);
    }

    // Get stock for this branch
    const inventory = await prisma.inventory.findUnique({
      where: {
        variantId_branchId: {
          variantId: variant.id,
          branchId,
        },
      },
    });

    // §2.4 — clearance-flagged variants price at the fixed clearancePrice and
    // the POS must lock all discounts on the line.
    const isClearance = variant.clearanceFlag && variant.clearancePrice != null;
    return {
      variantId: variant.id,
      barcode: variant.barcode,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      productName: variant.product.name,
      brand: variant.product.brand?.name,
      category: variant.product.category?.name,
      // §5/§13.3 — `price` is what the POS charges: MRP on a normal line, the
      // fixed clearancePrice on a clearance line. `salePrice` is the display-only
      // Sale Price printed on the barcode (never charged).
      price: isClearance ? Number(variant.clearancePrice) : this.nonClearanceChargePrice(variant),
      salePrice: this.computeInclusivePrice(variant),
      mrp:
        variant.mrpOverride != null
          ? Number(variant.mrpOverride)
          : variant.product.mrp != null
          ? Number(variant.product.mrp)
          : null,
      costPrice: Number(variant.costOverride ?? variant.product.costPrice),
      // §gst — dynamic rate on the charged price (≤ ₹2,500 → 5%, else 18%).
      taxRate: gstRateForPrice(
        isClearance ? Number(variant.clearancePrice) : this.nonClearanceChargePrice(variant)
      ),
      stock: inventory?.quantity ?? 0,
      clearance: isClearance,
    };
  }

  /**
   * Always return the inclusive (customer-facing) price to the cart, even
   * for products configured as tax-exclusive — the cashier sees the same
   * number as the customer pays. Tax is extracted from this on checkout.
   */
  /**
   * §13.3 — the tax-inclusive **Sale Price** (basePrice, or a variant override).
   * This is a DISPLAY value only — printed on the barcode label. It is NOT what
   * the customer is charged at the counter (that is the MRP, see below).
   */
  private computeInclusivePrice(variant: {
    priceOverride: { toString(): string } | null;
    product: {
      basePrice: { toString(): string };
      cgstRate: { toString(): string };
      sgstRate: { toString(): string };
      priceIncludesTax: boolean;
    };
  }): number {
    const raw = Number(variant.priceOverride ?? variant.product.basePrice);
    if (variant.product.priceIncludesTax) return raw;
    const rate =
      Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
    return Math.round(raw * (1 + rate / 100) * 100) / 100;
  }

  /**
   * §5/§13.3 — the price a customer is actually CHARGED at the POS for a
   * non-clearance line: the **MRP** (per-variant `mrpOverride`, else the
   * product MRP), which by Indian retail convention is already the final
   * tax-inclusive price — so no tax uplift is applied. Falls back to the Sale
   * Price only for legacy products that have no MRP set (with a tax uplift if
   * that product is priced tax-exclusive). Clearance is handled by callers.
   */
  private nonClearanceChargePrice(variant: {
    mrpOverride?: { toString(): string } | null;
    priceOverride: { toString(): string } | null;
    product: {
      mrp?: { toString(): string } | null;
      basePrice: { toString(): string };
      cgstRate: { toString(): string };
      sgstRate: { toString(): string };
      priceIncludesTax: boolean;
    };
  }): number {
    const mrp = variant.mrpOverride ?? variant.product.mrp;
    if (mrp != null) return Number(mrp); // MRP is final tax-inclusive.
    const raw = Number(variant.priceOverride ?? variant.product.basePrice);
    if (variant.product.priceIncludesTax) return raw;
    const rate =
      Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
    return Math.round(raw * (1 + rate / 100) * 100) / 100;
  }

  async searchProducts(query: string, branchId: number) {
    const variants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        OR: [
          { product: { name: { contains: query, mode: 'insensitive' } } },
          { product: { brand: { name: { contains: query, mode: 'insensitive' } } } },
          // CODE fields match on prefix so "895" doesn't drag in SKU "3895" or a
          // barcode that merely contains "895" as a substring.
          { sku: { startsWith: query, mode: 'insensitive' } },
          { barcode: { startsWith: query, mode: 'insensitive' } },
        ],
      },
      include: {
        product: {
          include: {
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
      },
      take: 20,
    });

    const variantIds = variants.map((v) => v.id);
    const inventories = await prisma.inventory.findMany({
      where: { variantId: { in: variantIds }, branchId },
    });
    const stockMap = new Map(inventories.map((i) => [i.variantId, i.quantity]));

    return variants.map((v) => {
      // §2.4 — clearance variants price at the fixed clearancePrice and the POS
      // must lock all discounts/offers on the line. The search dropdown is the
      // common add-to-cart path, so it MUST carry the clearance flag + price too
      // (not just /pos/lookup/:barcode).
      const isClearance = v.clearanceFlag && v.clearancePrice != null;
      return {
        variantId: v.id,
        barcode: v.barcode,
        sku: v.sku,
        size: v.size,
        color: v.color,
        productName: v.product.name,
        brand: v.product.brand?.name,
        category: v.product.category?.name,
        // §5/§13.3 — `price` is what the POS charges: the MRP on a normal line,
        // the fixed clearancePrice on a clearance line. `salePrice` is the
        // display-only Sale Price for the barcode (never charged).
        price: isClearance ? Number(v.clearancePrice) : this.nonClearanceChargePrice(v),
        salePrice: this.computeInclusivePrice(v),
        clearance: isClearance,
        // §13.3 — printed MRP: per-variant override wins, else the product MRP.
        mrp:
          v.mrpOverride != null
            ? Number(v.mrpOverride)
            : v.product.mrp != null
            ? Number(v.product.mrp)
            : null,
        // §gst — dynamic rate on the charged price (≤ ₹2,500 → 5%, else 18%).
        taxRate: gstRateForPrice(
          isClearance ? Number(v.clearancePrice) : this.nonClearanceChargePrice(v)
        ),
        stock: stockMap.get(v.id) ?? 0,
      };
    });
  }

  async holdCart(
    userId: number,
    branchId: number,
    cartData: any,
    customerId?: number,
    notes?: string
  ) {
    const HOLD_EXPIRY_HOURS = 24; // §4.4 — configurable later via Settings.
    const held = await prisma.heldTransaction.create({
      data: {
        branchId,
        userId,
        cartData,
        customerId: customerId || null,
        notes,
        expiresAt: new Date(Date.now() + HOLD_EXPIRY_HOURS * 60 * 60 * 1000),
      },
      include: { customer: true },
    });

    return held;
  }

  async listHeld(branchId: number) {
    // §4.4 — sweep expired holds (released/archived) before listing the active ones.
    await prisma.heldTransaction.deleteMany({
      where: { branchId, expiresAt: { not: null, lt: new Date() } },
    });

    const held = await prisma.heldTransaction.findMany({
      where: { branchId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return held;
  }

  async deleteHeld(id: number) {
    const held = await prisma.heldTransaction.findUnique({ where: { id } });

    if (!held) {
      throw new AppError('Held transaction not found', 404);
    }

    await prisma.heldTransaction.delete({ where: { id } });
  }

  async resumeHeld(id: number) {
    const held = await prisma.heldTransaction.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!held) {
      throw new AppError('Held transaction not found', 404);
    }

    await prisma.heldTransaction.delete({ where: { id } });

    return held;
  }

  async createUpiPayment(
    data: {
      items: { barcode: string; quantity: number }[];
      customerId?: number;
      discountAmount?: number;
      notes?: string;
    },
    userId: number,
    branchId: number
  ) {
    // 1. Verify user has an open session
    const session = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
    });

    if (!session) {
      throw new AppError('No open POS session. Open a session before checkout.', 400);
    }

    // 2. Resolve barcodes to variants
    const barcodes = data.items.map((i) => i.barcode);
    const variants = await prisma.productVariant.findMany({
      where: { barcode: { in: barcodes }, isActive: true },
      include: { product: true },
    });

    const variantByBarcode = new Map(variants.map((v) => [v.barcode, v]));

    for (const item of data.items) {
      if (!variantByBarcode.has(item.barcode)) {
        throw new AppError(`Barcode not found: ${item.barcode}`, 400);
      }
    }

    // 3. Check stock and calculate totals
    const cartItems: Array<{
      variantId: number;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      taxRate: number;
    }> = [];

    for (const item of data.items) {
      const variant = variantByBarcode.get(item.barcode)!;

      const inventory = await prisma.inventory.findUnique({
        where: {
          variantId_branchId: {
            variantId: variant.id,
            branchId,
          },
        },
      });

      if (!inventory || inventory.quantity < item.quantity) {
        throw new AppError(
          `Insufficient stock for ${variant.product.name} (${variant.size}/${variant.color}). Available: ${inventory?.quantity ?? 0}, Requested: ${item.quantity}`,
          400
        );
      }

      const taxRate =
        Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
      // §5/§13.3 — charge the MRP (or the fixed clearancePrice), matching checkout.
      const isClearance = variant.clearanceFlag && variant.clearancePrice != null;
      const unitPrice = isClearance
        ? Number(variant.clearancePrice)
        : this.nonClearanceChargePrice(variant);
      const costPrice = Number(variant.costOverride ?? variant.product.costPrice);

      cartItems.push({
        variantId: variant.id,
        quantity: item.quantity,
        unitPrice,
        costPrice,
        taxRate,
      });
    }

    // 4. Calculate totals — tax-inclusive (see `checkout` above for the
    //    rationale). Line prices are MRPs with GST already baked in; we
    //    extract the tax component for reporting and never add it on top.
    const discountAmount = data.discountAmount || 0;
    let subtotal = 0;
    let totalTax = 0;

    for (const item of cartItems) {
      const lineSubtotal = item.unitPrice * item.quantity;
      // §gst — dynamic rate on the per-unit price (≤ ₹2,500 → 5%, else 18%).
      const gstRate = gstRateForPrice(item.unitPrice);
      const lineTax = lineSubtotal * (gstRate / (100 + gstRate));
      subtotal += lineSubtotal;
      totalTax += lineTax;
    }

    subtotal = Math.round(subtotal * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;
    const saleTotal = Math.round((subtotal - discountAmount) * 100) / 100;

    if (saleTotal < 0) {
      throw new AppError('Discount exceeds sale total', 400);
    }

    // 5. Validate customer exists if provided
    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
      });
      if (!customer) {
        throw new AppError('Customer not found', 404);
      }
    }

    // 6. Create QR payment via gateway
    const intentId = `UPI-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const gatewayResponse = await getPaymentGateway().createQRPayment({
      orderId: intentId,
      amount: saleTotal,
      expiresInSeconds: 300,
    });

    // 7. Persist intent
    await prisma.upiPaymentIntent.create({
      data: {
        intentId,
        providerOrderId: gatewayResponse.providerOrderId,
        branchId,
        userId,
        amount: saleTotal,
        qrCodeUrl: gatewayResponse.qrCodeUrl,
        upiLink: gatewayResponse.upiLink,
        cartSnapshot: cartItems as any,
        customerId: data.customerId || null,
        discountAmount,
        expiresAt: gatewayResponse.expiresAt,
      },
    });

    return {
      intentId,
      qrCodeUrl: gatewayResponse.qrCodeUrl,
      upiLink: gatewayResponse.upiLink,
      amount: saleTotal,
      expiresAt: gatewayResponse.expiresAt,
    };
  }

  async checkUpiPaymentStatus(intentId: string, userId: number) {
    const intent = await prisma.upiPaymentIntent.findUnique({
      where: { intentId },
    });

    if (!intent) {
      throw new AppError('Payment intent not found', 404);
    }

    if (intent.userId !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    // Already completed
    if (intent.status === 'completed' && intent.saleId) {
      const sale = await prisma.sale.findUnique({
        where: { id: intent.saleId },
        select: { id: true, saleNumber: true },
      });
      return { status: 'completed', saleId: sale?.id, saleNumber: sale?.saleNumber };
    }

    // Already failed/expired
    if (intent.status === 'failed' || intent.status === 'expired') {
      return { status: intent.status };
    }

    // Check with provider
    const providerStatus = await getPaymentGateway().getPaymentStatus(intent.providerOrderId);

    if (providerStatus.status === 'completed') {
      const sale = await this._completeUpiSale(intent, providerStatus.utrNumber);
      return { status: 'completed', saleId: sale.id, saleNumber: sale.saleNumber };
    }

    if (providerStatus.status === 'failed' || providerStatus.status === 'expired') {
      await prisma.upiPaymentIntent.update({
        where: { id: intent.id },
        data: { status: providerStatus.status },
      });
      return { status: providerStatus.status };
    }

    return { status: 'pending' };
  }

  async handleUpiWebhook(headers: Record<string, string>, rawBody: string) {
    const result = getPaymentGateway().verifyWebhook(headers, rawBody);

    if (!result.isValid) {
      throw new AppError('Invalid webhook signature', 400);
    }

    const intent = await prisma.upiPaymentIntent.findUnique({
      where: { intentId: result.orderId },
    });

    if (intent && intent.status === 'pending') {
      if (result.status === 'completed') {
        await this._completeUpiSale(intent, result.utrNumber);
      } else if (result.status === 'failed') {
        await prisma.upiPaymentIntent.update({
          where: { id: intent.id },
          data: { status: 'failed' },
        });
      }
    }
  }

  private async _completeUpiSale(
    intent: {
      id: number;
      intentId: string;
      branchId: number;
      userId: number;
      amount: any;
      saleId: number | null;
      cartSnapshot: any;
      customerId: number | null;
      discountAmount: any;
    },
    utrNumber?: string
  ) {
    // Idempotency guard
    if (intent.saleId) {
      const existing = await prisma.sale.findUnique({ where: { id: intent.saleId } });
      if (existing) return existing;
    }

    const cartItems = intent.cartSnapshot as Array<{
      variantId: number;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      taxRate: number;
    }>;

    const saleTotal = Number(intent.amount);
    const discountAmount = Number(intent.discountAmount);

    return prisma.$transaction(async (tx) => {
      // Calculate line items
      let subtotal = 0;
      let totalTax = 0;
      const itemsForCreation: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxAmount: number;
        total: number;
      }> = [];

      for (const item of cartItems) {
        const lineSubtotal = item.unitPrice * item.quantity;
        // §gst — dynamic rate on the per-unit price (≤ ₹2,500 → 5%, else 18%).
        const gstRate = gstRateForPrice(item.unitPrice);
        const lineTax = lineSubtotal * (gstRate / (100 + gstRate));
        const lineTotal = lineSubtotal;

        subtotal += lineSubtotal;
        totalTax += lineTax;

        itemsForCreation.push({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: 0,
          taxAmount: Math.round(lineTax * 100) / 100,
          total: Math.round(lineTotal * 100) / 100,
        });
      }

      subtotal = Math.round(subtotal * 100) / 100;
      totalTax = Math.round(totalTax * 100) / 100;

      // Create the sale (UPI gateway flow is an at-counter walk-in tender)
      const saleNumber = await nextBillNumber(tx, 'walkin');

      // §11.0 — roll up into the cashier's open shift trading day if there is one;
      // fall back to today's calendar date for an unattended gateway settlement.
      const upiSession = await tx.posSession.findFirst({
        where: { userId: intent.userId, status: 'open' },
      });
      const now = new Date();
      const upiBusinessDate = upiSession
        ? businessDateOf(upiSession)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const sale = await tx.sale.create({
        data: {
          branchId: intent.branchId,
          userId: intent.userId,
          customerId: intent.customerId,
          saleNumber,
          businessDate: upiBusinessDate,
          subtotal,
          taxAmount: totalTax,
          discountAmount,
          total: saleTotal,
          notes: `UPI payment - Intent: ${intent.intentId}`,
          items: {
            create: itemsForCreation,
          },
          payments: {
            create: [{
              method: 'upi' as PaymentMethod,
              amount: saleTotal,
              referenceNumber: utrNumber || intent.intentId,
            }],
          },
        },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
          payments: true,
          customer: true,
        },
      });

      // Deduct inventory and create movement records
      for (const item of cartItems) {
        await tx.inventory.update({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: intent.branchId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId: intent.branchId,
            type: MovementType.sale,
            quantity: -item.quantity,
            referenceId: sale.id,
            referenceType: 'sale',
            createdBy: intent.userId,
          },
        });
      }

      // Update customer visit/spend if provided
      if (intent.customerId) {
        await tx.customer.update({
          where: { id: intent.customerId },
          data: {
            visitCount: { increment: 1 },
            totalSpent: { increment: saleTotal },
          },
        });
      }

      // Update UPI intent
      await tx.upiPaymentIntent.update({
        where: { id: intent.id },
        data: {
          saleId: sale.id,
          status: 'completed',
          utrNumber: utrNumber || null,
          completedAt: new Date(),
        },
      });

      return sale;
    });
  }
}

export const posService = new PosService();
