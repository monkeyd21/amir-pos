/**
 * GST rules for woven girls' kidswear (4-digit HSN, turnover < ₹5 Cr).
 *
 * §gst — the rate is DYNAMIC per line, based on the per-unit sale value charged:
 *   ≤ ₹2,500  → 5%  (2.5% CGST + 2.5% SGST intra-state / 5% IGST inter-state)
 *   > ₹2,500  → 18% (9% CGST + 9% SGST / 18% IGST)
 * The threshold is compared against the tax-inclusive per-unit price actually
 * charged (post-discount), per the store's MRP-inclusive pricing model.
 */
export const APPAREL_GST_THRESHOLD = 2500;

export function gstRateForPrice(unitPriceInclusive: number): number {
  return unitPriceInclusive <= APPAREL_GST_THRESHOLD ? 5 : 18;
}

/**
 * HSN routing by category. Dress (Pakistani suits / ethnic sets) is 6211; all
 * other kidswear categories (CORDSET, Frocks, One Piece, and any unmapped) are
 * matching-set / dress goods → 6204.
 */
export function hsnForCategory(category: string | null | undefined): string {
  const c = (category || '').trim().toUpperCase();
  switch (c) {
    case 'DRESS':
      return '6211';
    case 'CORDSET':
    case 'FROCK':
    case 'FROCKS':
    case 'ONE PIECE':
      return '6204';
    default:
      return '6204';
  }
}
