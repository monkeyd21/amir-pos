import prisma from '../../config/database';
import { Offer, OfferType, Prisma } from '@prisma/client';

/**
 * Decimal-safe math helpers. Prisma returns Decimal for Decimal columns,
 * but JSON bodies carry them as strings or numbers. Normalize to plain numbers
 * here — this engine deals in paise/cents at the boundaries.
 */
const toNum = (v: Prisma.Decimal | number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  return Number(v.toString());
};

/** Round to 2 decimal places (currency) */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CartLine {
  variantId: number;
  quantity: number;
  /** Unit price before any discount (from variant.priceOverride ?? product.basePrice) */
  unitPrice: number;
}

export interface DiscountResult {
  /** true if the offer's conditions are met given current line quantity */
  qualified: boolean;
  /** Total discount amount off the line (positive number). 0 when not qualified. */
  discountAmount: number;
  /** Effective unit price after the offer. Used for returns. 0 when not qualified. */
  effectiveUnitPrice: number;
  /** Final line total (unitPrice * quantity - discountAmount) */
  lineTotal: number;
  /**
   * Human-readable hint when the offer exists but isn't yet qualified.
   * e.g. "Add 1 more to qualify for Buy 2 Get 1 Free"
   */
  hint?: string;
  /** Short display label like "20% OFF" or "Buy 2 Get 1 Free" */
  displayText: string;
}

// ─── Display text ───────────────────────────────────────────────

export function describeOffer(offer: Offer): string {
  switch (offer.type) {
    case 'percentage':
      return `${toNum(offer.percentValue)}% OFF`;
    case 'flat':
      return `Rs. ${toNum(offer.flatValue)} OFF`;
    case 'buy_x_get_y_free':
      return `Buy ${offer.buyQty} Get ${offer.getQty} Free`;
    case 'buy_x_get_y_percent':
      return `Buy ${offer.buyQty} Get ${toNum(offer.percentValue)}% Off`;
    case 'bundle':
      return `${offer.buyQty} for Rs. ${toNum(offer.flatValue)}`;
    default:
      return offer.name;
  }
}

// ─── Discount computation ───────────────────────────────────────

/**
 * Compute the discount for a single cart line given an offer.
 * Pure function — no DB calls, no side effects.
 */
export function computeDiscount(
  offer: Offer,
  unitPrice: number,
  quantity: number
): DiscountResult {
  const display = describeOffer(offer);
  const lineGross = round2(unitPrice * quantity);

  const makeResult = (
    qualified: boolean,
    discountAmount: number,
    hint?: string
  ): DiscountResult => {
    const amt = qualified ? round2(discountAmount) : 0;
    const lineTotal = round2(lineGross - amt);
    const effectiveUnitPrice = qualified && quantity > 0 ? round2(lineTotal / quantity) : 0;
    return {
      qualified,
      discountAmount: amt,
      effectiveUnitPrice,
      lineTotal,
      hint,
      displayText: display,
    };
  };

  switch (offer.type) {
    case 'percentage': {
      const pct = toNum(offer.percentValue);
      if (pct <= 0) return makeResult(false, 0);
      const discount = (lineGross * pct) / 100;
      return makeResult(true, discount);
    }

    case 'flat': {
      const off = toNum(offer.flatValue);
      if (off <= 0) return makeResult(false, 0);
      // Never discount more than the line total
      const discount = Math.min(off * quantity, lineGross);
      return makeResult(true, discount);
    }

    case 'buy_x_get_y_free': {
      const buy = offer.buyQty ?? 0;
      const get = offer.getQty ?? 0;
      if (buy <= 0 || get <= 0) return makeResult(false, 0);

      // Group size: you need (buy + get) units to get (get) units free.
      // Wait, convention here: "Buy 2 Get 1 Free" means pay for 2, get 3 — group size = 3.
      // So every `buy+get` units, `get` are free.
      // Actually, re-thinking: the standard interpretation is "buy X get Y free"
      // where X is the paid portion. Total qty per group = X + Y. Free count = Y.
      const groupSize = buy + get;
      if (quantity < groupSize) {
        const missing = groupSize - quantity;
        return makeResult(
          false,
          0,
          `Add ${missing} more to qualify for ${display}`
        );
      }
      const freeUnits = Math.floor(quantity / groupSize) * get;
      const discount = freeUnits * unitPrice;
      return makeResult(true, discount);
    }

    case 'buy_x_get_y_percent': {
      const buy = offer.buyQty ?? 0;
      const pct = toNum(offer.percentValue);
      if (buy <= 0 || pct <= 0) return makeResult(false, 0);

      if (quantity < buy) {
        const missing = buy - quantity;
        return makeResult(
          false,
          0,
          `Add ${missing} more to qualify for ${display}`
        );
      }
      // Discount applies to ALL units in the line once threshold is met.
      const discount = (lineGross * pct) / 100;
      return makeResult(true, discount);
    }

    case 'bundle': {
      const buy = offer.buyQty ?? 0;
      const bundleTotal = toNum(offer.flatValue);
      if (buy <= 0 || bundleTotal <= 0) return makeResult(false, 0);

      if (quantity < buy) {
        const missing = buy - quantity;
        return makeResult(
          false,
          0,
          `Add ${missing} more for ${display}`
        );
      }
      // For every `buy` units, the total is `bundleTotal`.
      // Remaining units (qty % buy) are priced at regular unitPrice.
      const bundles = Math.floor(quantity / buy);
      const remainderQty = quantity - bundles * buy;
      const bundledGross = bundles * buy * unitPrice;
      const bundledDiscounted = bundles * bundleTotal;
      const discount = bundledGross - bundledDiscounted;
      // discount is only from the bundled portion; remainder pays full.
      return makeResult(true, round2(discount));
    }

    default:
      return makeResult(false, 0);
  }
}

// ─── Offer resolution (DB-backed) ───────────────────────────────

const now = () => new Date();

/** Prisma filter for offers that are currently active */
export const activeOfferWhere = (): Prisma.OfferWhereInput => {
  const n = now();
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: n } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: n } }] },
    ],
  };
};

/**
 * Resolve the best active offer for a variant.
 * Checks variant-level assignments first, then product-level.
 * Highest priority wins within each scope. Variant-level always beats product-level.
 */
export async function resolveOfferForVariant(
  variantId: number
): Promise<Offer | null> {
  // 1) Variant-level
  const variantOffer = await prisma.offer.findFirst({
    where: {
      ...activeOfferWhere(),
      variants: { some: { variantId } },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  if (variantOffer) return variantOffer;

  // 2) Product-level (via the variant's product)
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });
  if (!variant) return null;

  const productOffer = await prisma.offer.findFirst({
    where: {
      ...activeOfferWhere(),
      products: { some: { productId: variant.productId } },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  return productOffer;
}

/**
 * Evaluate an entire cart: resolve offer + compute discount for each line.
 * Bulk-fetches offers in as few queries as possible.
 */
export async function evaluateCart(
  lines: CartLine[]
): Promise<
  Array<{ line: CartLine; offer: Offer | null; result: DiscountResult | null }>
> {
  if (lines.length === 0) return [];

  const variantIds = [...new Set(lines.map((l) => l.variantId))];

  // Fetch all variants with productId in one query
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, productId: true },
  });
  const variantToProduct = new Map(variants.map((v) => [v.id, v.productId]));
  const productIds = [...new Set(variants.map((v) => v.productId))];

  // Bulk-fetch all active offers that touch any of these variants or products
  const candidateOffers = await prisma.offer.findMany({
    where: {
      ...activeOfferWhere(),
      OR: [
        { variants: { some: { variantId: { in: variantIds } } } },
        { products: { some: { productId: { in: productIds } } } },
      ],
    },
    include: {
      variants: { select: { variantId: true } },
      products: { select: { productId: true } },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });

  // Build lookup maps: variantId -> best offer, productId -> best offer
  const variantOfferMap = new Map<number, Offer>();
  const productOfferMap = new Map<number, Offer>();
  for (const offer of candidateOffers) {
    const { variants: ovs, products: ops, ...offerData } = offer;
    for (const { variantId } of ovs) {
      if (!variantOfferMap.has(variantId)) {
        variantOfferMap.set(variantId, offerData as Offer);
      }
    }
    for (const { productId } of ops) {
      if (!productOfferMap.has(productId)) {
        productOfferMap.set(productId, offerData as Offer);
      }
    }
  }

  // Resolve per line: variant-level first, then product-level
  return lines.map((line) => {
    let offer = variantOfferMap.get(line.variantId) ?? null;
    if (!offer) {
      const productId = variantToProduct.get(line.variantId);
      if (productId !== undefined) {
        offer = productOfferMap.get(productId) ?? null;
      }
    }
    const result = offer
      ? computeDiscount(offer, line.unitPrice, line.quantity)
      : null;
    return { line, offer, result };
  });
}
