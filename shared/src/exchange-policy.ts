/**
 * §0/§2.4 — who may come back, and how.
 *
 * This lives in `shared/` rather than in the backend because the rule has two
 * readers that must never disagree: the server gate that refuses a bad return,
 * and the UI pickers that decide which lines the cashier is even offered. When
 * the picker was a hand-written `!item.nonReturnable` filter it silently
 * swallowed every clearance line: the line was exchangeable, the server would
 * have accepted it, and the cashier simply could not see it to pick it. Twice.
 * One function, imported by both, is what stops that recurring.
 *
 * The store-wide policy separates two different rights that used to be
 * collapsed into one `nonReturnable` boolean:
 *
 *   - REFUND   — money goes back to the customer.
 *   - EXCHANGE — goods are swapped, no money goes back.
 *
 * A clearance line is "exchange freely, refund only on a senior say-so": dead
 * stock is sold at a marked-down fixed price, the store will swap a size or
 * colour for anyone, and it will pay the money back only when a Manager or an
 * Owner authorises it with the Owner PIN. Blocking the exchange too (the old
 * behaviour) was over-broad; blocking the refund outright turned out to be too
 * (the shop does relent, it just wants the decision to sit with a senior).
 *
 * The reason the refund is gated rather than free is real: an exchange nets the
 * returned value against the new purchase, so returning a ₹700 clearance item
 * against a ₹200 replacement pays out ₹500 — a refund by another name. That
 * escape is closed by `clearanceCashOutBlocked`, which is the same gate wearing
 * different clothes: both routes out of the till need the PIN.
 *
 * The bill itself keeps saying NON-RETURNABLE (see `sales/receipt-pdf.ts`). The
 * PIN is a discretionary exception the shop grants, deliberately not a right
 * the printed receipt invites the customer to expect.
 *
 * This module only says WHICH rule applies. Checking the PIN is the service's
 * job — policy stays free of auth so it can be reasoned about (and tested)
 * without a database.
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

/**
 * What it takes to REFUND this line for money.
 *
 *   'allowed'   — any cashier, no ceremony.
 *   'owner-pin' — clearance goods: a Manager or Owner authorises with the
 *                 Owner PIN (§6.4), the same PIN that gates the discretion
 *                 discount and the EOD variance.
 *   'never'     — the goods themselves never come back for money: the product
 *                 is flagged, or the cashier sold this line as-is at the
 *                 counter. No PIN opens that; it is not about the price paid.
 */
export type RefundRule = 'allowed' | 'owner-pin' | 'never';

export function refundRule(line: ExchangeLinePolicy): RefundRule {
  if (line.productNonReturnable) return 'never';
  // Checked before the line flag on purpose: clearance SETS that flag at
  // checkout, so reading the flag first would classify every clearance line as
  // a cashier's as-is sale and slam a door the PIN is meant to open.
  if (line.isClearance) return 'owner-pin';
  if (line.lineNonReturnable) return 'never';
  return 'allowed';
}

/** True when this line refunds with no authorisation at all. */
export function canRefundLine(line: ExchangeLinePolicy): boolean {
  return refundRule(line) === 'allowed';
}

/**
 * §0 equal-or-greater-value — an exchange that includes clearance goods does
 * not settle as cash out on a cashier's own authority.
 *
 * Only the clearance share is protected. A bill mixing a ₹700 clearance item
 * with a ₹1,000 full-price item can still refund down to the full-price item's
 * value; it is specifically the clearance money that must stay in the store
 * unless the Owner PIN says otherwise — paying it out IS a clearance refund, so
 * it answers to `refundRule`'s 'owner-pin' and not to a second, looser rule.
 *
 * @param nonRefundableCredit ₹ of exchange credit that came from clearance lines
 * @param refundDue           ₹ the exchange would otherwise pay out (≥ 0)
 */
export function clearanceCashOutBlocked(nonRefundableCredit: number, refundDue: number): boolean {
  return nonRefundableCredit > 0 && refundDue > 0.0001;
}
