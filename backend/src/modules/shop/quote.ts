/**
 * What the shopper will pay, and why.
 *
 * The quote is display and record-keeping. The AUTHORITATIVE money math for the
 * ledger happens inside `posService.checkout`, which the shop calls at
 * settlement — so this module must agree with it exactly. It does that by using
 * the same inputs: `pos/pricing` for unit prices, the offers engine for
 * promotions, the loyalty config for redemption value, and `gstRateForPrice`
 * for tax.
 */
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { shopConfig } from '../../config/shop';
import { gstRateForPrice } from '../../utils/tax';
import { evaluateCart, CartLine } from '../offers/engine';
import { getCartView } from './cart';

const round = (n: number): number => Math.round(n * 100) / 100;

export interface QuoteRequest {
  cartId: number;
  paymentMode?: 'prepaid' | 'cod';
  loyaltyPointsRedeem?: number;
  customerId?: number | null;
  pincode?: string | null;
}

export interface QuoteLine {
  variantId: number;
  productName: string;
  size: string;
  ageLabel: string | null;
  quantity: number;
  unitPrice: number;
  mrp: number;
  offerId: number | null;
  offerDiscount: number;
  lineTotal: number;
}

export async function buildQuote(req: QuoteRequest) {
  const cart = await getCartView(req.cartId);
  if (cart.lines.length === 0) throw new AppError('Your bag is empty', 400);

  const paymentMode = req.paymentMode ?? 'prepaid';
  if (paymentMode === 'cod' && !shopConfig.commerce.codEnabled) {
    throw new AppError('Cash on delivery is not available at the moment', 400);
  }

  // ── Offers ────────────────────────────────────────────────────────────────
  // Counter-only promotions must never leak onto the website, so anything
  // without `onlineEligible` is dropped after the engine has run.
  const cartLines: CartLine[] = cart.lines.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
  }));

  const evaluated = await evaluateCart(cartLines, { onlineOnly: true });
  const offerByVariant = new Map<number, { offerId: number; discount: number }>();
  for (const e of evaluated) {
    if (!e.offer || !e.result?.qualified) continue;
    // A clearance line's price is locked; it never takes an offer.
    const line = cart.lines.find((l) => l.variantId === e.line.variantId);
    if (line?.isClearance) continue;
    offerByVariant.set(e.line.variantId, {
      offerId: e.offer.id,
      discount: e.result.discountAmount,
    });
  }

  const lines: QuoteLine[] = cart.lines.map((l) => {
    const offer = offerByVariant.get(l.variantId);
    return {
      variantId: l.variantId,
      productName: l.productName,
      size: l.size,
      ageLabel: l.ageLabel,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      mrp: l.mrp,
      offerId: offer?.offerId ?? null,
      offerDiscount: round(offer?.discount ?? 0),
      lineTotal: round(l.lineTotal - (offer?.discount ?? 0)),
    };
  });

  const subtotal = round(cart.subtotal);
  const offerDiscount = round(lines.reduce((s, l) => s + l.offerDiscount, 0));

  // ── Loyalty ───────────────────────────────────────────────────────────────
  let loyaltyDiscount = 0;
  let loyaltyPointsRedeemed = 0;

  if (req.loyaltyPointsRedeem && req.loyaltyPointsRedeem > 0) {
    if (!shopConfig.commerce.loyaltyRedeemableOnline) {
      throw new AppError('Loyalty points cannot be redeemed online', 400);
    }
    if (!req.customerId) {
      throw new AppError('Please sign in to redeem loyalty points', 401);
    }

    const [customer, cfg] = await Promise.all([
      prisma.customer.findUnique({ where: { id: req.customerId } }),
      prisma.loyaltyConfig.findFirst(),
    ]);
    if (!customer) throw new AppError('Customer not found', 404);

    // Same rule as the counter: a minimum balance is always retained, and only
    // the excess above it is redeemable.
    const minRedeem = cfg?.minRedeemPoints ?? 100;
    const redeemable = Math.max(0, customer.loyaltyPoints - minRedeem);
    if (req.loyaltyPointsRedeem > redeemable) {
      throw new AppError(
        redeemable === 0
          ? `No points available to redeem — a balance of ${minRedeem} must be kept.`
          : `You can redeem at most ${redeemable} points.`,
        400
      );
    }

    loyaltyPointsRedeemed = req.loyaltyPointsRedeem;
    loyaltyDiscount = round(loyaltyPointsRedeemed * Number(cfg?.redemptionValue ?? 1));
  }

  // ── Prepaid incentive ─────────────────────────────────────────────────────
  const afterItemDiscounts = Math.max(0, round(subtotal - offerDiscount - loyaltyDiscount));
  const prepaidDiscount =
    paymentMode === 'prepaid' && shopConfig.commerce.prepaidDiscountPercent > 0
      ? round((afterItemDiscounts * shopConfig.commerce.prepaidDiscountPercent) / 100)
      : 0;

  const goodsTotal = Math.max(0, round(afterItemDiscounts - prepaidDiscount));

  // ── Delivery ──────────────────────────────────────────────────────────────
  // Free on everything in v1 — see the note on COMMERCE.flatShippingFee.
  const shipping =
    shopConfig.commerce.flatShippingFee > 0 &&
    goodsTotal < shopConfig.commerce.freeDeliveryAbove
      ? shopConfig.commerce.flatShippingFee
      : 0;

  const codFee = paymentMode === 'cod' ? shopConfig.commerce.codFee : 0;

  const total = round(goodsTotal + shipping + codFee);

  // ── GST, extracted from the tax-inclusive prices ──────────────────────────
  // Rates are per line and depend on the value actually charged: 5% at or under
  // ₹2,500 a unit, 18% above (utils/tax.ts). Discounts are apportioned by line
  // value so the extracted tax reflects what the customer really paid.
  const discountsToApportion = loyaltyDiscount + prepaidDiscount;
  const apportionBase = lines.reduce((s, l) => s + l.lineTotal, 0);
  let taxAmount = 0;

  for (const line of lines) {
    const share =
      apportionBase > 0 ? (line.lineTotal / apportionBase) * discountsToApportion : 0;
    const lineTaxable = Math.max(0, line.lineTotal - share);
    const perUnit = line.quantity > 0 ? lineTaxable / line.quantity : lineTaxable;
    const rate = gstRateForPrice(perUnit);
    taxAmount += lineTaxable - lineTaxable / (1 + rate / 100);
  }
  taxAmount = round(taxAmount);

  return {
    lines,
    paymentMode,
    subtotal,
    mrpTotal: cart.mrpTotal,
    offerDiscount,
    loyaltyDiscount,
    loyaltyPointsRedeemed,
    prepaidDiscount,
    /** Everything knocked off the sticker price, for the "you saved" line. */
    totalSavings: round(cart.mrpTotal - goodsTotal),
    goodsTotal,
    shipping,
    codFee,
    taxAmount,
    total,
    freeDeliveryApplied: shipping === 0,
    codAvailable: shopConfig.commerce.codEnabled,
    holdExpiresAt: cart.holdExpiresAt,
  };
}

export type Quote = Awaited<ReturnType<typeof buildQuote>>;
