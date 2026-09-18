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
 * the more recently created offer, then the narrower assignment, then the lower
 * id so the answer is stable. Scope sits here, at the very bottom, and only
 * where two offers are worth the customer exactly the same.
 */
const byHouseOrder = (a: OfferChoice, b: OfferChoice): number =>
  b.offer.priority - a.offer.priority ||
  b.offer.createdAt.getTime() - a.offer.createdAt.getTime() ||
  Number(b.scope === 'variant') - Number(a.scope === 'variant') ||
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
 * The rule, in one line: the customer gets the best deal available.
 *
 *  1. Every offer that APPLIES at this quantity competes, whether it was
 *     assigned to the whole article or to specific variants.
 *  2. The largest discount off the line wins.
 *  3. Priority (then recency, then the narrower assignment, then id) breaks
 *     genuine ties only.
 *
 * Scope used to gate this: variant-level offers were considered first and
 * product-level ones only got a turn if none of them applied. The reasoning was
 * that singling out a variant is the shop saying "this one is different", so a
 * blanket offer should not override it. Real data killed that. A shop ran
 * "Rs 50 off" on specific variants and "3 for Rs 1200" on the whole article;
 * the flat offer qualifies at every quantity, so it always won and the bundle
 * could never apply. Targeting and value are different things, and gating one
 * by the other quietly charged customers more.
 *
 * A variant-level offer can now be beaten by an article-wide one, but only ever
 * by a BIGGER discount, never a smaller one. If the shop ever needs "these
 * pieces are excluded from the article-wide offer", that wants an exclusion
 * flag saying so, not a scope hierarchy doing it as a side effect.
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

  // The nudge is drawn from everything that did not apply — an upsell the
  // cashier can voice is worth saying whatever the offer was attached to.
  const notYet = scored.filter((s) => !s.result.qualified).sort(byUpsellValue);

  const qualified = scored.filter((s) => s.result.qualified).sort(byCustomerValue);
  if (qualified.length > 0) {
    const chosen = qualified[0];
    const upcoming = notYet.find((s) => !!s.result.hint);
    return upcoming ? { ...chosen, upcoming } : chosen;
  }

  // Nothing applies at this quantity. Hand back the offer the shop would most
  // like mentioned, so the line still carries its "add 1 more" hint.
  return notYet[0] ?? null;
}

// ─── Bundles pool across the cart ───────────────────────────────

/**
 * "3 for Rs. 1200" means ANY three pieces the offer covers — three sizes, three
 * colours, three different articles — not three of one variant.
 *
 * That distinction is the whole reason this exists. Every other offer type is a
 * property of ONE line: a percentage, a flat amount, a buy-x-get-y run all read
 * a single line's quantity and answer for it. A bundle is a property of the
 * BASKET, and the cart splits a basket by variant (`pos-terminal` merges scans
 * on variantId), so three sizes of the same article arrive as three lines of
 * one. Asking each line "do you hold three?" answers no three times, and on a
 * rail carrying one piece per size the deal could never fire at all.
 *
 * So a bundle is priced over the pool of every line it covers, and the discount
 * is then apportioned BACK onto those lines. Apportionment is not cosmetic:
 * `SaleItem.offerId` and `effectiveUnitPrice` are per line, and a refund pays
 * back `SaleItem.total ÷ quantity`, so a customer returning one piece of a
 * three-for-1200 must get its fair share of the deal, never a third of the
 * shelf price.
 */

/** One line's share of a pooled bundle. */
export interface PooledBundle {
  /** True when the pool holds enough units AND the deal is worth applying. */
  qualified: boolean;
  /** Total discount across the whole pool. */
  discountAmount: number;
  /** That discount split back over the participating lines, by line index. */
  byLine: Map<number, number>;
  /** How many units each line actually put INTO the bundle, by line index. */
  unitsByLine: Map<number, number>;
  /** Units still to be added before it applies, or before the NEXT one does. */
  shortfall: number;
  hint?: string;
  /** Units left over after the last whole bundle. */
  leftoverUnits: number;
}

const emptyPool = (shortfall = 0, hint?: string, leftoverUnits = 0): PooledBundle => ({
  qualified: false,
  discountAmount: 0,
  byLine: new Map(),
  unitsByLine: new Map(),
  shortfall,
  hint,
  leftoverUnits,
});

/**
 * Price one bundle offer across every line it covers.
 *
 * Which units go into the bundle when the basket holds more than a whole
 * multiple: the DEAREST ones. Four pieces on a "3 for 1200" pay 1200 for the
 * three most expensive and shelf price for the cheapest, which is the largest
 * saving available and the only choice a customer would not argue with.
 *
 * A bundle that costs MORE than the pieces it covers is not applied at all,
 * rather than applied as a surcharge dressed as a deal.
 */
export function poolBundle(
  offer: Offer,
  lines: Array<{ index: number; unitPrice: number; quantity: number }>
): PooledBundle {
  const buy = offer.buyQty ?? 0;
  const bundleTotal = toNum(offer.flatValue);
  if (offer.type !== 'bundle' || buy <= 0 || bundleTotal <= 0) return emptyPool();

  const units: Array<{ index: number; unitPrice: number }> = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i += 1) {
      units.push({ index: line.index, unitPrice: line.unitPrice });
    }
  }
  if (units.length === 0) return emptyPool();

  if (units.length < buy) {
    const shortfall = buy - units.length;
    return emptyPool(
      shortfall,
      `Add ${shortfall} more for ${describeOffer(offer)}`,
      units.length
    );
  }

  const bundles = Math.floor(units.length / buy);
  const selected = [...units]
    .sort((a, b) => b.unitPrice - a.unitPrice || a.index - b.index)
    .slice(0, bundles * buy);

  const bundledGross = selected.reduce((sum, u) => sum + u.unitPrice, 0);
  const discount = round2(bundledGross - bundles * bundleTotal);
  if (discount <= 0) return emptyPool();

  // Apportion by the value each line put INTO the bundle, so the line that
  // contributed the dearest pieces carries the largest share of the saving.
  const grossByLine = new Map<number, number>();
  const unitsByLine = new Map<number, number>();
  for (const u of selected) {
    grossByLine.set(u.index, (grossByLine.get(u.index) ?? 0) + u.unitPrice);
    unitsByLine.set(u.index, (unitsByLine.get(u.index) ?? 0) + 1);
  }
  const byLine = new Map<number, number>();
  let allocated = 0;
  for (const [index, gross] of grossByLine) {
    const share = round2((discount * gross) / bundledGross);
    byLine.set(index, share);
    allocated = round2(allocated + share);
  }
  // Rounding drift lands on the largest share, so the parts always sum to the
  // whole and the bill never disagrees with itself by a paisa.
  const drift = round2(discount - allocated);
  if (drift !== 0 && byLine.size > 0) {
    let biggest = [...byLine.entries()][0];
    for (const entry of byLine) if (entry[1] > biggest[1]) biggest = entry;
    byLine.set(biggest[0], round2(biggest[1] + drift));
  }

  const leftoverUnits = units.length - selected.length;
  return {
    qualified: true,
    discountAmount: discount,
    byLine,
    unitsByLine,
    // What the NEXT bundle needs, counted over the pieces left outside this one.
    shortfall: leftoverUnits > 0 ? buy - leftoverUnits : 0,
    hint:
      leftoverUnits > 0
        ? `Add ${buy - leftoverUnits} more for ${describeOffer(offer)}`
        : undefined,
    leftoverUnits,
  };
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

  // Candidates per line, then the per-line answer at this line's quantity.
  const candidatesByLine = lines.map((line): OfferCandidate[] => {
    const productId = variantToProduct.get(line.variantId);
    return [
      ...(variantOfferMap.get(line.variantId) ?? []).map(
        (offer): OfferCandidate => ({ offer, scope: 'variant' })
      ),
      ...(productId !== undefined ? productOfferMap.get(productId) ?? [] : []).map(
        (offer): OfferCandidate => ({ offer, scope: 'product' })
      ),
    ];
  });

  const baseline = lines.map((line, i) =>
    chooseBestOffer(candidatesByLine[i], line.unitPrice, line.quantity)
  );

  // ── Bundles, priced over the basket rather than the line ──
  //
  // A bundle covering several lines is worth more pooled than it can ever be
  // worth line by line, and on a rail with one piece per size it is worth
  // nothing otherwise. It takes the lines only when the pool beats what those
  // same lines already had, so a bundle never costs the customer a better deal
  // they were already getting.
  const bundlesById = new Map<number, { offer: Offer; lineIndexes: number[] }>();
  candidatesByLine.forEach((candidates, i) => {
    for (const c of candidates) {
      if (c.offer.type !== 'bundle') continue;
      const entry = bundlesById.get(c.offer.id);
      if (entry) entry.lineIndexes.push(i);
      else bundlesById.set(c.offer.id, { offer: c.offer, lineIndexes: [i] });
    }
  });

  const pooledByLine = new Map<
    number,
    { offer: Offer; discount: number; unitsInBundle: number }
  >();
  const pooledHintByLine = new Map<number, string>();
  const claimed = new Set<number>();

  // Best deal first, so the strongest bundle picks its lines before a weaker
  // one can take them.
  const pools = [...bundlesById.values()]
    .map((b) => ({
      ...b,
      pooled: poolBundle(
        b.offer,
        b.lineIndexes.map((i) => ({
          index: i,
          unitPrice: lines[i].unitPrice,
          quantity: lines[i].quantity,
        }))
      ),
    }))
    .sort((a, b) => b.pooled.discountAmount - a.pooled.discountAmount);

  for (const pool of pools) {
    const free = pool.lineIndexes.filter((i) => !claimed.has(i));
    if (free.length === 0) continue;
    // Recompute over only the lines still available, so a line taken by a
    // stronger bundle cannot also prop up a weaker one.
    const pooled =
      free.length === pool.lineIndexes.length
        ? pool.pooled
        : poolBundle(
            pool.offer,
            free.map((i) => ({
              index: i,
              unitPrice: lines[i].unitPrice,
              quantity: lines[i].quantity,
            }))
          );

    if (!pooled.qualified) {
      // Not there yet: tell the cashier how close the BASKET is, which is the
      // number the customer can act on ("add 1 more"), not a per-line count.
      if (pooled.hint) {
        for (const i of free) if (!pooledHintByLine.has(i)) pooledHintByLine.set(i, pooled.hint);
      }
      continue;
    }

    const baselineDiscount = round2(
      free.reduce((sum, i) => sum + (baseline[i]?.result.discountAmount ?? 0), 0)
    );
    if (pooled.discountAmount <= baselineDiscount) continue;

    for (const [index, share] of pooled.byLine) {
      pooledByLine.set(index, {
        offer: pool.offer,
        discount: share,
        unitsInBundle: pooled.unitsByLine.get(index) ?? 0,
      });
      claimed.add(index);
    }

    // Pieces left over after the last whole bundle get a nudge counted over
    // THOSE pieces, not over one line: two leftovers need one more piece, and
    // saying "add 2 more" because one line happens to hold one piece is how the
    // cashier ends up promising the wrong thing.
    if (pooled.hint) {
      for (const i of free) if (!claimed.has(i)) pooledHintByLine.set(i, pooled.hint);
    }
  }

  return lines.map((line, i) => {
    const pooled = pooledByLine.get(i);
    if (pooled) {
      const gross = round2(line.unitPrice * line.quantity);

      // A bundle consumes UNITS, but an offer is recorded per LINE, so a line
      // can end up with some units inside the deal and some outside. Those
      // outside keep the offer they would have had on their own — otherwise a
      // customer buying 2+2+1 pays more than one buying 2+1+2 for the same five
      // pieces, purely because of how the cart happened to split.
      //
      // The line still records the bundle as its offer, because that is the
      // deal that priced it; `effectiveUnitPrice` is the line's average, which
      // is what a refund pays back (`SaleItem.total ÷ quantity`).
      const outside = line.quantity - pooled.unitsInBundle;
      const fallback = baseline[i]?.offer;
      let outsideDiscount = 0;
      if (outside > 0 && fallback && fallback.type !== 'bundle') {
        const r = computeDiscount(fallback, line.unitPrice, outside);
        if (r.qualified) outsideDiscount = r.discountAmount;
      }

      const discountAmount = round2(pooled.discount + outsideDiscount);
      const lineTotal = round2(gross - discountAmount);
      return {
        line,
        offer: pooled.offer,
        result: {
          qualified: true,
          discountAmount,
          effectiveUnitPrice: round2(lineTotal / line.quantity),
          lineTotal,
          displayText: describeOffer(pooled.offer),
        } as DiscountResult,
        upcomingHint: undefined,
      };
    }
    const choice = baseline[i];
    return {
      line,
      offer: choice?.offer ?? null,
      result: choice?.result ?? null,
      // The pooled shortfall counts the whole basket, so it supersedes the
      // per-line nudge whenever there is one.
      upcomingHint: pooledHintByLine.get(i) ?? choice?.upcoming?.result.hint,
    };
  });
}
