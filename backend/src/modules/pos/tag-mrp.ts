/**
 * One rule for "what does the tag say", used by every POS surface.
 *
 * Per CLAUDE.md §3 the variant owns the price stack, so `mrpOverride` wins and
 * the product's `mrp` is only the creation-time template behind it. There is
 * deliberately NO fall back to `basePrice`: that column is a Sale Price
 * template, not a tag price. Reading it as one invented an MRP the shelf never
 * carried, and the bill then printed a saving against a price nobody was ever
 * asked to pay, while the POS screen (which correctly reported no MRP) showed
 * none. When nothing is known the honest answer is null: no tag, no saving.
 */
export interface TagMrpSource {
  mrpOverride?: unknown;
  product: { mrp?: unknown };
}

/** The tag/MRP for a variant, or null when the shelf carries no MRP at all. */
export function tagMrp(variant: TagMrpSource): number | null {
  if (variant.mrpOverride != null) return Number(variant.mrpOverride);
  if (variant.product.mrp != null) return Number(variant.product.mrp);
  return null;
}

/**
 * The tag/MRP to snapshot onto a SaleItem at checkout, so the bill can print the
 * historical tag even after the variant is repriced or leaves clearance.
 *
 * With no MRP known, the tag price IS the charged price. That keeps the printed
 * bill agreeing with the POS screen the cashier just looked at, and leaves the
 * receipt's MRP floor with nothing to hide.
 */
export function snapshotMrp(variant: TagMrpSource, unitPrice: number): number {
  return tagMrp(variant) ?? unitPrice;
}
