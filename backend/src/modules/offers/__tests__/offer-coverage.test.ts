import { offerCoverage } from '@clothing-erp/shared';

/**
 * The offers list and the offer page used to count differently, in opposite
 * directions on the same data: an offer assigned to 5 whole articles read
 * "5 products / 0 variants" on the list while the page showed every variant
 * those articles hold, and an offer assigned to 87 variants across 8 articles
 * read "1 product" because only one article had been assigned whole.
 *
 * These lock the single definition both screens now use.
 */
describe('offer coverage', () => {
  it('counts a whole article as all of its variants', () => {
    expect(offerCoverage({ productIds: [1], variantProductIds: [] }, { 1: 15 })).toEqual({
      articles: 1,
      variants: 15,
    });
  });

  it('counts the articles behind variant-level assignments', () => {
    // 4 variants spread over 2 articles: 2 articles, 4 variants.
    expect(
      offerCoverage({ productIds: [], variantProductIds: [7, 7, 9, 9] })
    ).toEqual({ articles: 2, variants: 4 });
  });

  it('does not count a named variant twice inside a whole article', () => {
    // The article is covered whole AND three of its variants are named.
    expect(
      offerCoverage({ productIds: [3], variantProductIds: [3, 3, 3] }, { 3: 12 })
    ).toEqual({ articles: 1, variants: 12 });
  });

  it('adds both scopes when they touch different articles', () => {
    // Article 1 whole (15 variants) + 2 named variants on article 2.
    expect(
      offerCoverage({ productIds: [1], variantProductIds: [2, 2] }, { 1: 15 })
    ).toEqual({ articles: 2, variants: 17 });
  });

  it('reproduces the production offer that read "1 product / 87 variants"', () => {
    // One article covered whole, plus 87 variants spanning 8 other articles.
    const variantProductIds = Array.from({ length: 87 }, (_, i) => 10 + (i % 8));
    expect(
      offerCoverage({ productIds: [1], variantProductIds }, { 1: 15 })
    ).toEqual({ articles: 9, variants: 102 });
  });

  it('counts an article with no known variant total honestly rather than throwing', () => {
    expect(offerCoverage({ productIds: [4], variantProductIds: [] })).toEqual({
      articles: 1,
      variants: 0,
    });
  });

  it('is empty for an offer assigned to nothing', () => {
    expect(offerCoverage({ productIds: [], variantProductIds: [] })).toEqual({
      articles: 0,
      variants: 0,
    });
  });

  it('accepts a Map of totals as readily as a record', () => {
    expect(
      offerCoverage({ productIds: [5], variantProductIds: [] }, new Map([[5, 6]]))
    ).toEqual({ articles: 1, variants: 6 });
  });
});
