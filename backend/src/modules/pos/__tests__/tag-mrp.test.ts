import { snapshotMrp, tagMrp } from '../tag-mrp';

/**
 * The tag/MRP must never be invented from `product.basePrice`.
 *
 * basePrice is a Sale Price template (CLAUDE.md §3), and it is the product level
 * one at that. Reading it as a tag price gave a variant charged Rs 150 an "MRP"
 * of Rs 3,999, so the printed bill claimed a Rs 3,849 saving against a price the
 * shelf never carried, while the POS screen for the same sale correctly showed
 * no MRP and no saving. The bill and the counter contradicted each other.
 */
const variant = (over: Record<string, unknown> = {}) => ({
  mrpOverride: null,
  ...over,
  product: { mrp: null, basePrice: 3999, ...((over.product as object) ?? {}) },
});

describe('tag MRP resolution', () => {
  describe('tagMrp', () => {
    it("uses the variant's own MRP first", () => {
      // Per CLAUDE.md §3 the variant owns the price stack.
      expect(tagMrp(variant({ mrpOverride: 1200, product: { mrp: 1000 } }))).toBe(1200);
    });

    it('falls back to the product MRP template', () => {
      expect(tagMrp(variant({ product: { mrp: 1000 } }))).toBe(1000);
    });

    it('returns null rather than reading basePrice as a tag price (the bug)', () => {
      // basePrice is 3999 on this fixture and must be ignored entirely.
      expect(tagMrp(variant())).toBeNull();
    });

    it('reads Prisma Decimal strings as numbers', () => {
      // Decimal columns arrive as strings; unwrapped they concatenate.
      expect(tagMrp(variant({ mrpOverride: '1200' }))).toBe(1200);
    });
  });

  describe('snapshotMrp', () => {
    it('snapshots the known tag, not the charged price', () => {
      expect(snapshotMrp(variant({ mrpOverride: 750 }), 670)).toBe(750);
    });

    it('snapshots a clearance line at its full tag against the clearance price', () => {
      expect(snapshotMrp(variant({ mrpOverride: 1200 }), 499)).toBe(1200);
    });

    it('snapshots the CHARGED price when no MRP exists, never basePrice (the bug)', () => {
      // 150 charged, basePrice 3999. Before this, the bill printed MRP Rs 3,999
      // and "You Saved Rs 3,849" on a line the POS showed no saving for.
      expect(snapshotMrp(variant(), 150)).toBe(150);
    });

    it('leaves the receipt with no saving to show on such a line', () => {
      // Same figure on both sides means the MRP floor collapses it to zero.
      const charged = 150;
      const snapshot = snapshotMrp(variant(), charged);
      expect(Math.max(snapshot, charged) - charged).toBe(0);
    });
  });
});
