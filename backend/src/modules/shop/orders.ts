/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ORDERS — placement, payment and settlement
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The boundary this module exists to hold:
 *
 *    A `ShopOrder` is a fulfilment record. A `Sale` is a ledger record.
 *
 *  An order that has been placed but not paid is not a sale — no money has
 *  moved, no stock has left, no GST is due. So `saleId` stays NULL until
 *  settlement, and a cancelled unpaid order leaves no trace in the books. That
 *  is why the accounting, reporting and P&L code needed no changes at all.
 *
 *  Settlement itself delegates to `posService.checkout({ channel: 'online' })`
 *  — the same function the till calls. Bill numbering, GST, loyalty accrual,
 *  stock movements and idempotency are therefore the existing, tested code
 *  paths, not a second implementation.
 */
import crypto from 'crypto';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { shopConfig } from '../../config/shop';
import { getPaymentGateway } from '../../services/payment-gateway';
import { sendWhatsAppText } from '../messaging/whatsapp';
import { posService } from '../pos/service';
import { getShopSystemUserId } from './system-user';
import { buildQuote } from './quote';
import { getCartView, clearCart } from './cart';
import {
  attachHoldsToOrder,
  consumeOrderHolds,
  releaseOrderHolds,
  extendCartHolds,
  assertRawStockCovers,
  SoldOutError,
} from './availability';

const round = (n: number): number => Math.round(n * 100) / 100;

/** O-0001-style numbers are the ERP's; the shop's own reference is separate. */
async function nextOrderNumber(): Promise<string> {
  const seq = await prisma.billSequence.upsert({
    where: { key: 'shop_order' },
    create: { key: 'shop_order', lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `SE${String(seq.lastNumber).padStart(6, '0')}`;
}

export interface PlaceOrderInput {
  cartId: number;
  customerId: number;
  addressId: number;
  paymentMode?: 'prepaid' | 'cod';
  loyaltyPointsRedeem?: number;
  notes?: string;
}

/**
 * Turn a cart into an order awaiting payment.
 *
 * Holds are extended and re-pointed from the cart to the order, so cart cleanup
 * can never drop the stock a pending order is relying on.
 */
export async function placeOrder(input: PlaceOrderInput) {
  // §safety — the master switch. A browse-only shop is a useful thing; a shop
  // that accepts orders it cannot collect on or fulfil is not.
  if (!shopConfig.commerce.checkoutEnabled) {
    throw new AppError(
      'Online ordering is not open yet. Message us on WhatsApp and we will reserve it for you.',
      503
    );
  }

  const paymentMode = input.paymentMode ?? 'prepaid';

  if (paymentMode === 'cod' && !shopConfig.commerce.codEnabled) {
    throw new AppError('Cash on delivery is not available at the moment', 400);
  }

  const address = await prisma.address.findFirst({
    where: { id: input.addressId, customerId: input.customerId },
  });
  if (!address) throw new AppError('Delivery address not found', 404);

  const cart = await getCartView(input.cartId);
  if (cart.lines.length === 0) throw new AppError('Your bag is empty', 400);

  // Any lapsed hold means the stock may already be gone. Make the shopper
  // revisit the bag rather than discovering it after payment.
  const lapsed = cart.lines.filter((l) => l.holdExpiresAt === null);
  if (lapsed.length > 0) {
    throw new AppError(
      'Your bag was held for a while and needs re-checking. Please open your bag again.',
      409
    );
  }

  const quote = await buildQuote({
    cartId: input.cartId,
    customerId: input.customerId,
    paymentMode,
    loyaltyPointsRedeem: input.loyaltyPointsRedeem,
  });

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: quote.lines.map((l) => l.variantId) } },
    include: { product: { select: { name: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.shopOrder.create({
      data: {
        orderNumber: await nextOrderNumber(),
        customerId: input.customerId,
        branchId: shopConfig.branchId,
        status: 'pending_payment',
        paymentMode,
        shipName: address.name,
        shipPhone: address.phone,
        shipLine1: address.line1,
        shipLine2: address.line2,
        shipLandmark: address.landmark,
        shipCity: address.city,
        shipState: address.state,
        shipPincode: address.pincode,
        subtotal: quote.subtotal,
        discountAmount: quote.offerDiscount,
        loyaltyDiscountAmount: quote.loyaltyDiscount,
        prepaidDiscountAmount: quote.prepaidDiscount,
        shippingAmount: quote.shipping,
        codFeeAmount: quote.codFee,
        taxAmount: quote.taxAmount,
        total: quote.total,
        loyaltyPointsRedeemed: quote.loyaltyPointsRedeemed,
        // Carried through to Sale.clientRef, so a replayed webhook can never
        // create a second bill for the same order.
        clientRef: crypto.randomUUID(),
        notes: input.notes,
        items: {
          create: quote.lines.map((l) => {
            const v = byId.get(l.variantId);
            return {
              variantId: l.variantId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              mrp: l.mrp,
              discount: l.offerDiscount,
              total: l.lineTotal,
              offerId: l.offerId,
              productName: v?.product.name ?? 'Item',
              sizeName: v?.size ?? '',
              colorName: v?.color ?? null,
            };
          }),
        },
      },
      include: { items: true },
    });

    // Keep the stock held for the whole payment attempt, and move the holds
    // onto the order so they outlive the cart.
    await extendCartHolds(tx, input.cartId, shopConfig.reservation.checkoutHoldMinutes);
    await attachHoldsToOrder(tx, input.cartId, created.id);

    return created;
  });

  return { order, quote };
}

/**
 * Create the gateway payment intent for a pending order.
 *
 * UPI QR / intent link, which is what the existing gateway driver speaks and
 * what the overwhelming majority of Indian shoppers pay with. The same driver
 * and the same webhook verification the till already uses.
 */
export async function createPaymentIntent(orderId: number) {
  const order = await prisma.shopOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'pending_payment') {
    throw new AppError('This order has already been paid for', 400);
  }
  if (order.paymentMode === 'cod') {
    throw new AppError('Cash-on-delivery orders take no online payment', 400);
  }

  const gateway = getPaymentGateway();
  const intentId = `SHOP-${order.orderNumber}-${Date.now().toString(36)}`;

  // Keep the payment window inside the stock hold: a shopper must never be
  // able to pay for something whose hold has already lapsed.
  const expiresInSeconds = shopConfig.reservation.checkoutHoldMinutes * 60;

  const intent = await gateway.createQRPayment({
    orderId: intentId,
    amount: Number(order.total),
    customerPhone: order.shipPhone,
    description: `${shopConfig.identity.name} order ${order.orderNumber}`,
    expiresInSeconds,
  });

  await prisma.$transaction(async (tx) => {
    await tx.shopOrder.update({
      where: { id: order.id },
      data: {
        paymentIntentId: intentId,
        paymentProviderRef: intent.providerOrderId,
        paymentQrUrl: intent.qrCodeUrl,
        paymentUpiLink: intent.upiLink,
        paymentExpiresAt: intent.expiresAt,
      },
    });
    // Re-extend the holds so they comfortably outlast the payment window: the
    // shopper must never be able to pay for stock whose hold has lapsed.
    await tx.stockReservation.updateMany({
      where: { orderId: order.id, status: 'held' },
      data: {
        expiresAt: new Date(
          Date.now() +
            (shopConfig.reservation.checkoutHoldMinutes +
              shopConfig.reservation.paymentGraceMinutes) *
              60_000
        ),
      },
    });
  });

  return {
    intentId,
    qrCodeUrl: intent.qrCodeUrl,
    upiLink: intent.upiLink,
    expiresAt: intent.expiresAt,
    amount: Number(order.total),
  };
}

/**
 * Backstop for a webhook that never arrives: ask the gateway directly.
 * The storefront polls this while the shopper sits on the payment screen.
 */
export async function pollPaymentStatus(customerId: number, orderNumber: string) {
  const order = await prisma.shopOrder.findFirst({
    where: { orderNumber, customerId },
  });
  if (!order) throw new AppError('Order not found', 404);

  if (order.saleId) return { status: 'paid' as const, orderNumber };
  if (order.status === 'failed' || order.status === 'cancelled') {
    return { status: order.status, orderNumber, reason: order.cancelReason };
  }
  if (!order.paymentProviderRef) return { status: 'pending' as const, orderNumber };

  const remote = await getPaymentGateway().getPaymentStatus(order.paymentProviderRef);

  if (remote.status === 'completed') {
    const settled = await settleOrder(order.id, remote.utrNumber);
    return settled.settled
      ? { status: 'paid' as const, orderNumber }
      : { status: 'failed' as const, orderNumber, reason: settled.reason };
  }

  if (remote.status === 'failed' || remote.status === 'expired') {
    await prisma.$transaction(async (tx) => {
      await tx.shopOrder.update({
        where: { id: order.id },
        data: {
          status: 'failed',
          cancelledAt: new Date(),
          cancelReason: `Payment ${remote.status}`,
        },
      });
      await releaseOrderHolds(tx, order.id);
    });
    return { status: 'failed' as const, orderNumber, reason: `Payment ${remote.status}` };
  }

  return { status: 'pending' as const, orderNumber };
}

/**
 * ─── Settlement ───────────────────────────────────────────────────────────
 *
 * Called by the payment webhook (and by the status poll, as a backstop). This
 * is where an order becomes a Sale, and where the §4.5 re-check lives.
 *
 * Idempotent by three separate mechanisms, because a webhook WILL be delivered
 * twice: the order's own `saleId` short-circuit, the `clientRef` unique index
 * inside `checkout`, and the status guard.
 */
export async function settleOrder(
  orderId: number,
  paymentRef?: string
): Promise<{ settled: boolean; reason?: string }> {
  const order = await prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { items: { include: { variant: true } } },
  });
  if (!order) throw new AppError('Order not found', 404);

  // Already settled — a repeat webhook, which is routine.
  if (order.saleId) return { settled: true };
  if (order.status === 'cancelled' || order.status === 'failed') {
    return { settled: false, reason: order.status };
  }

  const systemUserId = await getShopSystemUserId();

  try {
    // The re-check and the sale must be atomic with respect to stock.
    await prisma.$transaction(async (tx) => {
      await assertRawStockCovers(
        tx,
        order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        order.branchId
      );
    });

    // `checkout` opens its own transaction. It re-checks stock itself via the
    // online guard (`assertOnlineStock`), so a race between the block above and
    // this call still fails safely rather than overselling.
    const result = await posService.checkout(
      {
        items: order.items.map((i) => ({
          barcode: i.variant.barcode,
          quantity: i.quantity,
        })),
        customerId: order.customerId,
        channel: 'online',
        clientRef: order.clientRef ?? undefined,
        // The prepaid incentive is a discount on goods; everything else was
        // already priced into the line totals by the offers engine.
        discountAmount: Number(order.prepaidDiscountAmount),
        loyaltyPointsRedeem: order.loyaltyPointsRedeemed || undefined,
        payments: [
          {
            method: order.paymentMode === 'cod' ? 'cash' : 'upi',
            amount: Number(order.total),
            referenceNumber: paymentRef || order.paymentIntentId || order.orderNumber,
          },
        ],
        notes: `Online order ${order.orderNumber}`,
      },
      systemUserId,
      order.branchId
    );

    await prisma.$transaction(async (tx) => {
      await tx.shopOrder.update({
        where: { id: order.id },
        data: { saleId: result.sale.id, status: 'paid', paidAt: new Date() },
      });
      await consumeOrderHolds(tx, order.id);
      // The cart has done its job; releasing it here would also release the
      // holds, so only the rows are cleared.
      await tx.shopCartItem.deleteMany({
        where: { cart: { customerId: order.customerId } },
      });
    });

    await notifyOrderConfirmed(order.id).catch((e) =>
      console.warn(`[shop/orders] confirmation message failed: ${e.message}`)
    );

    return { settled: true };
  } catch (err: any) {
    const soldOut =
      err instanceof SoldOutError || err?.statusCode === 409;

    if (!soldOut) throw err;

    // ── The defined recovery path (§4.5) ──────────────────────────────────
    // The goods went in the shop while the payment was in flight. No Sale is
    // written; the money goes back.
    await prisma.$transaction(async (tx) => {
      await tx.shopOrder.update({
        where: { id: order.id },
        data: {
          status: 'failed',
          cancelledAt: new Date(),
          cancelReason: err.message || 'Item sold out during payment',
        },
      });
      await releaseOrderHolds(tx, order.id);
    });

    await refundOrder(order.id, err.message).catch((e) =>
      console.error(`[shop/orders] REFUND FAILED for ${order.orderNumber}: ${e.message}`)
    );

    return { settled: false, reason: 'sold_out' };
  }
}

/**
 * Refund a payment taken for an order that could not be fulfilled.
 *
 * Deliberately loud on failure: a shopper who has paid for something they will
 * never receive is the worst outcome this system can produce, so a failure here
 * is logged as an error for a human to chase, never swallowed.
 */
async function refundOrder(orderId: number, reason: string): Promise<void> {
  const order = await prisma.shopOrder.findUnique({ where: { id: orderId } });
  if (!order || !order.paymentIntentId) return;

  // The gateway driver in this codebase (services/payment-gateway) exposes
  // createQRPayment / getPaymentStatus / verifyWebhook and NO refund call. So
  // rather than pretend, this records the obligation loudly and leaves the
  // order in `failed` — a human must issue the refund from the Cashfree
  // dashboard. Wiring a real refund endpoint is tracked in PLAN.md.
  console.error(
    `[shop/orders] MANUAL REFUND REQUIRED — order ${order.orderNumber}, ` +
      `Rs. ${order.total}, intent ${order.paymentIntentId}. Reason: ${reason}`
  );

  // Recorded against the customer so the obligation is visible in the ERP,
  // not only in a log file nobody reads.
  await prisma.messageLog
    .create({
      data: {
        customerId: order.customerId,
        type: 'whatsapp',
        template: 'shop_refund_due',
        status: 'failed',
        payload: {
          orderNumber: order.orderNumber,
          amount: Number(order.total),
          paymentIntentId: order.paymentIntentId,
          reason,
        },
      },
    })
    .catch(() => undefined);
}

/** Webhook entry point. Verifies the signature before trusting anything. */
export async function handleShopPaymentWebhook(
  headers: Record<string, string>,
  rawBody: string
) {
  const result = getPaymentGateway().verifyWebhook(headers, rawBody);
  if (!result.isValid) throw new AppError('Invalid webhook signature', 400);

  const order = await prisma.shopOrder.findFirst({
    where: { paymentIntentId: result.orderId },
  });
  if (!order) return { handled: false };

  if (result.status === 'completed') {
    return settleOrder(order.id, result.utrNumber);
  }

  if (result.status === 'failed' && order.status === 'pending_payment') {
    await prisma.$transaction(async (tx) => {
      await tx.shopOrder.update({
        where: { id: order.id },
        data: { status: 'failed', cancelledAt: new Date(), cancelReason: 'Payment failed' },
      });
      await releaseOrderHolds(tx, order.id);
    });
  }

  return { handled: true };
}

/** Cancel an unpaid order and hand its stock straight back. */
export async function cancelOrder(customerId: number, orderId: number, reason?: string) {
  const order = await prisma.shopOrder.findFirst({ where: { id: orderId, customerId } });
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'pending_payment') {
    throw new AppError('This order can no longer be cancelled online', 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.shopOrder.update({
      where: { id: order.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason || 'Cancelled by customer',
      },
    });
    await releaseOrderHolds(tx, order.id);
  });

  return { cancelled: true };
}

// ─── Reads ───────────────────────────────────────────────────────────────

const orderView = {
  items: true,
  shipments: { orderBy: { createdAt: 'desc' } },
} as const;

export async function listOrders(customerId: number) {
  return prisma.shopOrder.findMany({
    where: { customerId },
    include: orderView,
    orderBy: { placedAt: 'desc' },
  });
}

export async function getOrder(customerId: number, orderNumber: string) {
  const order = await prisma.shopOrder.findFirst({
    where: { orderNumber, customerId },
    include: orderView,
  });
  if (!order) throw new AppError('Order not found', 404);
  return order;
}

// ─── Notifications ───────────────────────────────────────────────────────

async function notifyOrderConfirmed(orderId: number): Promise<void> {
  const order = await prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return;

  const lines = order.items
    .map((i) => `• ${i.productName} (size ${i.sizeName}) × ${i.quantity}`)
    .join('\n');

  const text =
    `Thank you! Your ${shopConfig.identity.name} order ${order.orderNumber} is confirmed.\n\n` +
    `${lines}\n\n` +
    `Total paid: Rs. ${round(Number(order.total))}\n` +
    `We'll dispatch from ${shopConfig.delivery.originCity} within ` +
    `${shopConfig.delivery.dispatchDays} working days and send you the tracking link.`;

  await sendWhatsAppText({ to: `91${order.shipPhone.replace(/\D/g, '').slice(-10)}`, text });
}
