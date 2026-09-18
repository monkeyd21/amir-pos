import prisma from '../../config/database';

/**
 * One row of the customer's points ledger, narrowed to what the rewind needs.
 * `saleId` + `type` identify the rows a checkout wrote for a given bill.
 */
export interface LedgerMovement {
  id: number;
  points: number;
  saleId?: number | null;
  type?: string | null;
}

/** Ledger types a CHECKOUT writes; a return writes 'adjusted' under the same saleId. */
const CHECKOUT_TYPES = ['earned', 'redeemed'];

/**
 * The points balance a bill leaves the customer holding.
 *
 * `Customer.loyaltyPoints` is a LIVE running balance — every later purchase,
 * redemption, adjustment or return moves it — so printing it straight onto a
 * bill would make a reprint contradict the copy the customer is already
 * holding. A bill is a historical document: the number on it must stay the
 * balance the customer walked out with on the day.
 *
 * The ledger is what makes that recoverable. Every mutation of
 * `Customer.loyaltyPoints` writes a matching `LoyaltyTransaction` row (POS
 * checkout, returns, and the loyalty module's earn/redeem/adjust), so the
 * balance as of this sale is the live balance REWOUND by every movement
 * recorded after it. Rewinding rather than summing the ledger forward is
 * deliberate: seeded and legacy customers carry an opening balance with no
 * ledger rows behind it, and only the rewind stays right for them.
 *
 * `ledgerSince` is the customer's movements from this sale's instant onwards,
 * oldest first. The cut is this sale's own checkout rows: a return against the
 * SAME bill writes its restore/claw-back under the same `saleId`, and that
 * happened after the bill was handed over, so it belongs to the rewind. A bill
 * that moved no points has no row to cut on, and everything from its instant
 * onwards is later movement.
 *
 * Floored at zero — no bill ever prints a negative balance.
 */
export function pointsBalanceAfterSale(
  liveBalance: number,
  saleId: number,
  ledgerSince: LedgerMovement[]
): number {
  let cut = -1;
  ledgerSince.forEach((row, i) => {
    if (row.saleId === saleId && CHECKOUT_TYPES.includes(String(row.type))) cut = i;
  });
  const later = ledgerSince
    .slice(cut + 1)
    .reduce((sum, row) => sum + Number(row.points ?? 0), 0);
  return Math.max(0, Number(liveBalance ?? 0) - later);
}

/**
 * The loyalty lines a bill prints, in order, as [label, value] pairs. Both
 * receipt surfaces render exactly these rows, so the thermal bill and the PDF
 * can never disagree about a customer's points — two receipt surfaces drifting
 * apart has already been a bug here once.
 *
 * Nothing prints when loyalty is not in play: a walk-in bill has no balance at
 * all, and a customer bill that neither earned nor redeemed and has nothing
 * saved up gets no block rather than a row of zeroes. The balance itself is
 * printed even at zero once the block is showing, because "you have none left"
 * is the honest answer to a bill that just spent the lot.
 */
export function loyaltyReceiptRows(sale: {
  loyaltyPointsEarned?: number | null;
  loyaltyPointsRedeemed?: number | null;
  loyaltyPointsBalance?: number | null;
}): Array<[string, string]> {
  const earned = Number(sale.loyaltyPointsEarned ?? 0);
  const redeemed = Number(sale.loyaltyPointsRedeemed ?? 0);
  const balance = sale.loyaltyPointsBalance == null ? null : Number(sale.loyaltyPointsBalance);

  if (earned <= 0 && redeemed <= 0 && !(balance !== null && balance > 0)) return [];

  const rows: Array<[string, string]> = [];
  if (earned > 0) rows.push(['Points Earned', String(earned)]);
  if (redeemed > 0) rows.push(['Points Redeemed', String(redeemed)]);
  if (balance !== null) rows.push(['Points Balance', String(balance)]);
  return rows;
}

/**
 * The loyalty balance to print on one sale's receipt, or null when there is
 * nothing to print. A walk-in bill carries no customer and therefore no
 * balance line at all — never "0 points available".
 */
export async function receiptLoyaltyBalance(sale: {
  id: number;
  createdAt: Date | string;
  customer?: { id: number; loyaltyPoints: number } | null;
}): Promise<number | null> {
  const customer = sale.customer;
  if (!customer) return null;

  const ledgerSince: LedgerMovement[] =
    (await prisma.loyaltyTransaction.findMany({
      where: { customerId: customer.id, createdAt: { gte: new Date(sale.createdAt) } },
      select: { id: true, points: true, saleId: true, type: true },
      orderBy: { id: 'asc' },
    })) ?? [];

  return pointsBalanceAfterSale(customer.loyaltyPoints, sale.id, ledgerSince);
}
