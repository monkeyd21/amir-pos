import { Prisma } from '@prisma/client';

/**
 * Re-settle commissions after goods come back (return or exchange).
 *
 * BUSINESS RULE: commission is paid on the GROSS value sold at the point of sale.
 * The salesperson did their part; a later return or exchange is not their problem
 * and never claws back commission. So there is nothing to reconcile on a return —
 * this is intentionally a NO-OP. Commission is (re)computed only by the payroll
 * job `calculateCommissions`, which already values every sale at its gross amount.
 *
 * Kept as a stub (rather than deleted) so the return/exchange call sites don't
 * change; if the policy ever reverts to netting returns, restore the logic here.
 */
export async function reconcileCommissionsForSale(
  _tx: Prisma.TransactionClient,
  _saleId: number,
  _actorUserId: number,
  _branchId: number
): Promise<void> {
  // Intentionally does nothing — returns/exchanges do not affect commission.
  return;
}
