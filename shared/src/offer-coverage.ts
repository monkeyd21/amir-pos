/**
 * How much of the catalogue an offer actually reaches.
 *
 * An offer is assigned in two ways, and counting the raw assignment rows tells
 * the shopkeeper the wrong thing about both:
 *
 *   - PRODUCT level covers the whole article, every variant of it, including
 *     variants added tomorrow. Counting those rows as "0 variants" hides the
 *     fact that the offer reaches every size and colour on that rail.
 *   - VARIANT level covers exactly the variants named. Counting those rows as
 *     "1 product" hides the eight other articles those variants belong to.
 *
 * So the offers list and the offer page used to disagree in opposite
 * directions on the same offer: 5 products / 0 variants on one screen against
 * 5 articles and every variant they hold on the other. Both were counting
 * honestly, just not the same thing. This is the one definition they share:
 * how many ARTICLES the offer touches, and how many VARIANTS it truly reaches.
 *
 * An article assigned at BOTH levels counts once, as whole: that is what
 * applies at the till, and the named variants inside it are not counted twice.
 */
export interface OfferAssignments {
  /** productId per product-level assignment. */
  productIds: number[];
  /** The owning productId of each variant-level assignment, one entry per variant. */
  variantProductIds: number[];
}

export interface OfferCoverage {
  /** Distinct articles the offer touches, at either level. */
  articles: number;
  /** Variants the offer reaches: whole articles in full, plus named variants. */
  variants: number;
}

/**
 * @param variantTotals how many variants each whole-covered article holds,
 *                      keyed by productId. A missing entry counts as 0 rather
 *                      than throwing: a caller that cannot afford the lookup
 *                      still gets an honest article count.
 */
export function offerCoverage(
  assignments: OfferAssignments,
  variantTotals: Record<number, number> | Map<number, number> = {}
): OfferCoverage {
  const total = (productId: number): number =>
    variantTotals instanceof Map
      ? variantTotals.get(productId) ?? 0
      : variantTotals[productId] ?? 0;

  const whole = new Set(assignments.productIds);
  const touched = new Set<number>(whole);

  let variants = 0;
  for (const productId of whole) variants += total(productId);
  for (const productId of assignments.variantProductIds) {
    touched.add(productId);
    // Inside a whole-covered article the named variant is already counted.
    if (!whole.has(productId)) variants += 1;
  }

  return { articles: touched.size, variants };
}
