import { Prisma } from '@prisma/client';
import { getSetting } from '../modules/settings/service';
import { recordAudit } from './audit';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-settle commissions for a sale after goods come back (return or exchange).
 *
 * Commission is normally created by the payroll job (`calculateCommissions`)
 * for a pay period. This helper only touches commissions that *already exist*
 * for the sale — it never creates fresh ones (that's the payroll job's job, and
 * the job already nets out returned quantity for sales not yet processed).
 *
 * For each affected earner it computes the post-return target commission and
 * reconciles existing rows: amounts already **paid** are locked, so the
 * difference is written as a single **pending adjustment** (negative if the
 * earner was over-paid for goods since returned). Net of (paid + pending)
 * always equals the new target.
 */
export async function reconcileCommissionsForSale(
  tx: Prisma.TransactionClient,
  saleId: number,
  actorUserId: number,
  branchId: number
): Promise<void> {
  const existing = await tx.commission.findMany({ where: { saleId } });
  if (existing.length === 0) return; // not calculated yet — payroll will net it

  const mode = await getSetting<string>('commissionMode', 'item_level');
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    include: {
      user: { select: { id: true, commissionRate: true } },
      items: { include: { agent: { select: { id: true, commissionRate: true } } } },
      returns: { select: { total: true } },
    },
  });
  if (!sale) return;

  // Target (post-return) commission per earner.
  const targets = new Map<number, { amount: number; rate: number }>();
  if (mode === 'bill_level') {
    const refunded = sale.returns.reduce((s, r) => s + Number(r.total), 0);
    const netTotal = Math.max(0, Number(sale.total) - refunded);
    const rate = Number(sale.user.commissionRate);
    targets.set(sale.userId, { amount: round2(netTotal * (rate / 100)), rate });
  } else {
    const agentBase = new Map<number, { base: number; rate: number }>();
    for (const item of sale.items) {
      if (!item.agentId || !item.agent) continue;
      const live = item.quantity - item.returnedQuantity;
      const netLine = live <= 0 ? 0 : Number(item.total) * (live / item.quantity);
      const cur = agentBase.get(item.agentId) ?? { base: 0, rate: Number(item.agent.commissionRate) };
      cur.base += netLine;
      agentBase.set(item.agentId, cur);
    }
    for (const [agentId, { base, rate }] of agentBase) {
      targets.set(agentId, { amount: round2(base * (rate / 100)), rate });
    }
  }

  const userIds = new Set<number>([...existing.map((c) => c.userId), ...targets.keys()]);
  for (const userId of userIds) {
    const rows = existing.filter((c) => c.userId === userId);
    const paidSum = round2(
      rows.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)
    );
    const pendingRows = rows.filter((r) => r.status === 'pending');
    const pendingSum = round2(pendingRows.reduce((s, r) => s + Number(r.amount), 0));
    const target = targets.get(userId)?.amount ?? 0;
    const rate = targets.get(userId)?.rate ?? Number(rows[0]?.rate ?? 0);
    const desiredPending = round2(target - paidSum);

    // Already correct (single pending row matching, or nothing to change).
    if (desiredPending === pendingSum && pendingRows.length <= 1) continue;

    if (pendingRows.length > 0) {
      await tx.commission.deleteMany({ where: { id: { in: pendingRows.map((r) => r.id) } } });
    }
    if (desiredPending !== 0) {
      const today = new Date();
      await tx.commission.create({
        data: {
          userId,
          saleId,
          amount: desiredPending,
          rate,
          status: 'pending',
          payPeriodStart: today,
          payPeriodEnd: today,
        },
      });
    }
    await recordAudit(tx, {
      action: 'commission.reconciled',
      entityType: 'commission',
      entityId: `${saleId}-${userId}`,
      userId: actorUserId,
      branchId,
      data: { paidSum, previousPending: pendingSum, target, newPending: desiredPending },
    });
  }
}
