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
      const bundledGross = bundles * buy * unitPrice;
      const bundledDiscounted = bundles * bundleTotal;
      // An offer may never raise the price. A bundle total typed above the shelf
      // price of the same units (3 for Rs 1600 when 3 × 500 = 1500) would
      // otherwise surcharge the customer in the name of a discount.
      const discount = Math.max(0, bundledGross - bundledDiscounted);
      // discount is only from the bundled portion; remainder pays full.
      return makeResult(true, round2(discount));
    }

    default:
      return makeResult(false, 0);
  }
}

// ─── Choosing between offers that match the same line ───────────

export type OfferScope = 'variant' | 'product';

/** An offer that matches a line, and how it was reached. */
export interface OfferCandidate {
  offer: Offer;
  scope: OfferScope;
}

export interface OfferChoice {
  offer: Offer;
  scope: OfferScope;
  result: DiscountResult;
  /**
   * The best deal the line has NOT yet reached, when the chosen offer already
   * qualifies. Carries the "Add 1 more for 3 for Rs. 1200" nudge so a line that
   * is already discounted can still advertise the bigger deal one unit away.
   */
  upcoming?: OfferChoice;
}

/**
 * House order — the tie-break the shop controls: higher priority first, then
 * the more recently created offer, then the lower id so the answer is stable.
 */
const byHouseOrder = (a: OfferChoice, b: OfferChoice): number =>
  b.offer.priority - a.offer.priority ||
  b.offer.createdAt.getTime() - a.offer.createdAt.getTime() ||
  a.offer.id - b.offer.id;

/** Best for the customer first; house order only breaks a genuine tie. */
const byCustomerValue = (a: OfferChoice, b: OfferChoice): number =>
  b.result.discountAmount - a.result.discountAmount || byHouseOrder(a, b);

/** Among offers that don't apply yet, the one with something to say first. */
const byUpsellValue = (a: OfferChoice, b: OfferChoice): number =>
  Number(!!b.result.hint) - Number(!!a.result.hint) || byHouseOrder(a, b);

/**
 * Pick the offer a line gets, AT THE QUANTITY THE LINE HOLDS RIGHT NOW.
 * Pure function — feed it every offer that matches the line and it decides.
 *
 * The rule, in order:
 *
 *  1. Scope targets, it does not rank money. A variant-level assignment is the
 *     shop deliberately singling this article out, so variant-level offers are
 *     considered first — but only those that actually APPLY at this quantity.
 *     If none of them do, product-level offers get their turn rather than the
 *     line silently losing every discount.
 *  2. Within the scope that wins, the offer that is BEST FOR THE CUSTOMER at
 *     this quantity wins — the largest discount off the line.
 *  3. Priority (then recency, then id) breaks genuine ties only.
 *
 * Because every candidate is re-costed on each call, a threshold deal that was
 * out of reach at 2 units takes over the moment the 3rd is scanned, and hands
 * back if the cashier removes it again. This is what the old code got wrong: it
 * chose ONE offer per line by priority BEFORE looking at quantity, so a bundle
 * that lost the priority tie at qty 1 was never reconsidered at qty 3.
 *
 * One line always takes one offer — offers never stack on the same line, since
 * `SaleItem.offerId` records the single deal the customer was given.
 */
export function chooseBestOffer(
  candidates: OfferCandidate[],
  unitPrice: number,
  quantity: number
): OfferChoice | null {
  if (candidates.length === 0) return null;

  // The same offer can be assigned to both a variant and its product. It is
  // still one offer; keep it at its narrower scope.
  const unique = new Map<number, OfferCandidate>();
  for (const c of candidates) {
    const seen = unique.get(c.offer.id);
    if (!seen || (seen.scope === 'product' && c.scope === 'variant')) {
      unique.set(c.offer.id, c);
    }
  }

  const scored: OfferChoice[] = [...unique.values()].map((c) => ({
    offer: c.offer,
    scope: c.scope,
    result: computeDiscount(c.offer, unitPrice, quantity),
  }));

  const scopes: OfferScope[] = ['variant', 'product'];

  // The nudge is drawn from everything that did not apply, whatever its scope —
  // an upsell the cashier can voice is worth more than scope tidiness.
  const notYet = scored.filter((s) => !s.result.qualified).sort(byUpsellValue);

  for (const scope of scopes) {
    const qualified = scored
      .filter((s) => s.scope === scope && s.result.qualified)
      .sort(byCustomerValue);
    if (qualified.length > 0) {
      const chosen = qualified[0];
      const upcoming = notYet.find((s) => !!s.result.hint);
      return upcoming ? { ...chosen, upcoming } : chosen;
    }
  }

  // Nothing applies at this quantity. Return the offer the shop would most like
  // the cashier to mention, so the line still carries its "add 1 more" hint.
  for (const scope of scopes) {
    const inScope = notYet.filter((s) => s.scope === scope);
    if (inScope.length > 0) return inScope[0];
  }
  return null;
}

// ─── Offer resolution (DB-backed) ───────────────────────────────

const now = () => new Date();

/** Prisma filter for offers that are currently active */
/**
 * `onlineOnly` narrows to offers flagged `onlineEligible`. The storefront MUST
 * pass it — a counter-only promotion that leaked onto the website would be
 * honoured at the quote and then again at checkout, and the shopper would be
 * charged a different number from the one they agreed to.
 */
export const activeOfferWhere = (
  opts: { onlineOnly?: boolean } = {}
): Prisma.OfferWhereInput => {
  const n = now();
  return {
    isActive: true,
    ...(opts.onlineOnly ? { onlineEligible: true } : {}),
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: n } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: n } }] },
    ],
  };
};

/**
 * Resolve the offer a variant gets at a given quantity and unit price.
 * Collects every active assignment — variant-level and product-level — and
 * lets `chooseBestOffer` decide, so this agrees with `evaluateCart` exactly.
 */
export async function resolveOfferForVariant(
  variantId: number,
  quantity = 1,
  unitPrice = 0
): Promise<Offer | null> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });

  const offers = await prisma.offer.findMany({
    where: {
      ...activeOfferWhere(),
      OR: [
        { variants: { some: { variantId } } },
        ...(variant ? [{ products: { some: { productId: variant.productId } } }] : []),
      ],
    },
    include: {
      variants: { select: { variantId: true } },
      products: { select: { productId: true } },
    },
  });

  const candidates: OfferCandidate[] = [];
  for (const offer of offers) {
    const { variants: ovs, products: ops, ...offerData } = offer;
    if (ovs.some((v) => v.variantId === variantId)) {
      candidates.push({ offer: offerData as Offer, scope: 'variant' });
    } else if (variant && ops.some((p) => p.productId === variant.productId)) {
      candidates.push({ offer: offerData as Offer, scope: 'product' });
    }
  }

  return chooseBestOffer(candidates, unitPrice, quantity)?.offer ?? null;
}

/**
 * Evaluate an entire cart: resolve offer + compute discount for each line.
 * Bulk-fetches offers in as few queries as possible.
 */
export async function evaluateCart(
  lines: CartLine[],
  opts: { onlineOnly?: boolean } = {}
): Promise<
  Array<{
    line: CartLine;
    offer: Offer | null;
    result: DiscountResult | null;
    /** "Add 1 more for 3 for Rs. 1200" — the deal this line has not reached yet. */
    upcomingHint?: string;
  }>
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
      ...activeOfferWhere(opts),
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

  // Build lookup maps: every offer that matches a variant, and every offer that
  // matches a product. ALL of them — which one a line gets is a question only
  // `chooseBestOffer` can answer, and only once the line's quantity is known.
  const variantOfferMap = new Map<number, Offer[]>();
  const productOfferMap = new Map<number, Offer[]>();
  const push = (map: Map<number, Offer[]>, key: number, offer: Offer) => {
    const list = map.get(key);
    if (list) list.push(offer);
    else map.set(key, [offer]);
  };
  for (const offer of candidateOffers) {
    const { variants: ovs, products: ops, ...offerData } = offer;
    for (const { variantId } of ovs) push(variantOfferMap, variantId, offerData as Offer);
    for (const { productId } of ops) push(productOfferMap, productId, offerData as Offer);
  }

  // Resolve per line, at this line's current quantity.
  return lines.map((line) => {
    const productId = variantToProduct.get(line.variantId);
    const candidates: OfferCandidate[] = [
      ...(variantOfferMap.get(line.variantId) ?? []).map(
        (offer): OfferCandidate => ({ offer, scope: 'variant' })
      ),
      ...(productId !== undefined ? productOfferMap.get(productId) ?? [] : []).map(
        (offer): OfferCandidate => ({ offer, scope: 'product' })
      ),
    ];

    const choice = chooseBestOffer(candidates, line.unitPrice, line.quantity);
    return {
      line,
      offer: choice?.offer ?? null,
      result: choice?.result ?? null,
      upcomingHint: choice?.upcoming?.result.hint,
    };
  });
}
