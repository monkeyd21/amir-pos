/**
 * §0/§2.4 — who may come back, and how.
 *
 * The store-wide policy separates two different rights that used to be
 * collapsed into one `nonReturnable` boolean:
 *
 *   - REFUND   — money goes back to the customer.
 *   - EXCHANGE — goods are swapped, no money goes back.
 *
 * A clearance line is deliberately "no refund, exchange yes": dead stock is
 * sold at a marked-down fixed price, and the store will still swap a size or
 * colour, it just never pays cash for it. Blocking the exchange too (the old
 * behaviour) was over-broad and is the bug being fixed here.
 *
 * The reason the exchange used to be blocked outright is real, though: an
 * exchange nets the returned value against the new purchase, so returning a
 * ₹700 clearance item against a ₹200 replacement pays out ₹500 — a refund by
 * another name. That escape is closed by `clearanceCashOutBlocked` rather than
 * by refusing the swap.
 */

export interface ExchangeLinePolicy {
  /** SaleItem.isClearance — sold from clearance at a fixed marked-down price. */
  isClearance: boolean;
  /** SaleItem.nonReturnable — the cashier flagged this line at checkout. */
  lineNonReturnable: boolean;
  /** Product.nonReturnable — the article itself never comes back. */
  productNonReturnable: boolean;
}

/**
 * True when this line may be handed back as part of an EXCHANGE.
 *
 * A product flagged non-returnable blocks everything — that flag is about the
 * goods themselves (hygiene, defect-sold-as-is), not about the price paid. A
 * cashier-flagged line likewise blocks, EXCEPT when the line is a clearance
 * line, because clearance sets that same flag automatically at checkout to stop
 * refunds; it was never meant to stop swaps.
 */
export function canExchangeLine(line: ExchangeLinePolicy): boolean {
  if (line.productNonReturnable) return false;
  if (line.isClearance) return true;
  return !line.lineNonReturnable;
}

/** True when this line may be REFUNDED for money. Clearance never can. */
export function canRefundLine(line: ExchangeLinePolicy): boolean {
  return !line.productNonReturnable && !line.lineNonReturnable && !line.isClearance;
}

/**
 * §0 equal-or-greater-value — an exchange that includes clearance goods may not
 * settle as cash out.
 *
 * Only the clearance share is protected. A bill mixing a ₹700 clearance item
 * with a ₹1,000 full-price item can still refund down to the full-price item's
 * value; it is specifically the clearance money that must stay in the store.
 *
 * @param nonRefundableCredit ₹ of exchange credit that came from clearance lines
 * @param refundDue           ₹ the exchange would otherwise pay out (≥ 0)
 */
export function clearanceCashOutBlocked(nonRefundableCredit: number, refundDue: number): boolean {
  return nonRefundableCredit > 0 && refundDue > 0.0001;
}
