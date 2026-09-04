/**
 * §0 one exchange per bill: the BILL-level guard.
 *
 * This sits ON TOP of `exchange-policy.ts` and answers a different question.
 * `exchange-policy.ts` is per LINE: may this article come back, and may it come
 * back for money or only for a swap. This file is per BILL: has the shop
 * already swapped goods against this receipt once. Neither one knows about the
 * other, and neither may be folded into the other.
 *
 * Refund vs exchange
 * ------------------
 * The policy is one EXCHANGE per bill, so a bill that was merely refunded
 * against still has its exchange left. `Return.type` is the line that separates
 * them: every swap (POS checkout with an exchange, and the `/sales/:id/exchange`
 * endpoint alike) writes `type: 'exchange'`, while a plain refund writes
 * `type: 'return'`. Nothing else on the row distinguishes the two, so the type
 * is the only correct signal. Counting `sale.returns` outright would punish a
 * customer who came back once for a refund.
 *
 * Enforcement is a WARNING, not a block: the shop calls this a "general
 * policy", so a manager or an owner can approve a second swap. The cashier
 * cannot do it alone, and the approval is recorded against the bill.
 */

import { istDateLabel } from '../../utils/ist';

/** The shape of a `Return` row this guard needs. Anything wider is fine. */
export interface BillReturn {
  id: number;
  returnNumber: string;
  /** `Return.type`: 'return' for a refund, 'exchange' for a swap. */
  type: string;
  createdAt: Date | string;
}

/** The earlier swap that used up the bill's one exchange. */
export interface PriorExchange {
  id: number;
  returnNumber: string;
  /** ISO instant, so the client can render it in its own format. */
  createdAt: string;
  /** Ready-to-show IST date, e.g. `5 Sep 2026`. */
  dateLabel: string;
}

/** Roles allowed to approve a second exchange. A cashier is deliberately not one. */
export const EXCHANGE_OVERRIDE_ROLES: readonly string[] = ['owner', 'manager'];

const asDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

/**
 * The exchange that already ran against this bill, or null when the bill still
 * has its one exchange.
 *
 * When a bill somehow carries several (an earlier override), the EARLIEST is
 * returned: that is the one that consumed the allowance, and it is the date the
 * cashier needs to hear.
 */
export function findPriorExchange(
  returns: BillReturn[] | null | undefined
): PriorExchange | null {
  const exchanges = (returns ?? []).filter((r) => r?.type === 'exchange');
  if (exchanges.length === 0) return null;

  const earliest = exchanges.reduce((oldest, r) =>
    asDate(r.createdAt).getTime() < asDate(oldest.createdAt).getTime() ? r : oldest
  );
  const at = asDate(earliest.createdAt);

  return {
    id: earliest.id,
    returnNumber: earliest.returnNumber,
    createdAt: at.toISOString(),
    dateLabel: istDateLabel(at),
  };
}

/** True when this role may authorise a second exchange on a bill. */
export function canApproveExchangeOverride(role: string | null | undefined): boolean {
  return !!role && EXCHANGE_OVERRIDE_ROLES.includes(role);
}

/** What the cashier is told when the bill has already been exchanged. */
export function oneExchangePerBillMessage(
  saleNumber: string,
  prior: PriorExchange
): string {
  return (
    `Bill ${saleNumber} was already exchanged on ${prior.dateLabel} (${prior.returnNumber}). ` +
    'Store policy is one exchange per bill. A manager or owner can approve another one.'
  );
}

/**
 * The customer the replacement bill should carry.
 *
 * An exchange is served to the person named on the original bill, so the
 * cashier should never have to find or retype someone the shop already knows.
 * A customer the cashier chose explicitly always wins; a walk-in original
 * carries nobody, which is the ordinary case and not an error.
 */
export function carriedCustomerId(
  chosenCustomerId: number | null | undefined,
  originalBillCustomerId: number | null | undefined
): number | null {
  if (chosenCustomerId != null) return chosenCustomerId;
  return originalBillCustomerId ?? null;
}
