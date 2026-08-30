/**
 * Price resolution, shared by the POS and the storefront.
 *
 * Extracted from `PosService` so there is exactly ONE implementation of what a
 * customer is charged. The shop must never compute a price of its own — a
 * second implementation of this is how the till and the website end up
 * disagreeing about what something costs.
 *
 * See CLAUDE.md §3: the POS charges the SALE PRICE, not the MRP, and the
 * variant's materialised price stack always wins over the product template.
 */

export interface PricedVariant {
  mrpOverride?: { toString(): string } | null;
  priceOverride: { toString(): string } | null;
  clearanceFlag?: boolean;
  clearancePrice?: { toString(): string } | null;
  product: {
    mrp?: { toString(): string } | null;
    basePrice: { toString(): string };
    cgstRate: { toString(): string };
    sgstRate: { toString(): string };
    priceIncludesTax: boolean;
  };
}

/** Is this variant on clearance with a usable fixed price? */
export function isClearanceLine(v: PricedVariant): boolean {
  return Boolean(v.clearanceFlag && v.clearancePrice != null);
}

/**
 * What a NON-clearance line charges: the variant's Sale Price
 * (`priceOverride`) falling back to the product's `basePrice`, uplifted for tax
 * when the product stores prices tax-exclusive.
 *
 * MRP is only a fallback for legacy variants predating the materialised price
 * stack (7066a04). It travels on the line for the "was" price on the receipt,
 * but it does not decide what is charged.
 */
export function nonClearanceChargePrice(v: PricedVariant): number {
  const salePrice = v.priceOverride ?? v.product.basePrice;
  if (salePrice != null) {
    const raw = Number(salePrice);
    if (v.product.priceIncludesTax) return raw;
    const rate = Number(v.product.cgstRate) + Number(v.product.sgstRate);
    return Math.round(raw * (1 + rate / 100) * 100) / 100;
  }
  const mrp = v.mrpOverride ?? v.product.mrp;
  return mrp != null ? Number(mrp) : 0;
}

/** The final tax-inclusive unit price actually charged, clearance included. */
export function chargePrice(v: PricedVariant): number {
  return isClearanceLine(v) ? Number(v.clearancePrice) : nonClearanceChargePrice(v);
}

/**
 * The tag/MRP shown struck through as the "was" price. Variant override wins,
 * then the product template, then the base price.
 */
export function mrpFor(v: PricedVariant): number {
  if (v.mrpOverride != null) return Number(v.mrpOverride);
  if (v.product.mrp != null) return Number(v.product.mrp);
  return Number(v.product.basePrice);
}
