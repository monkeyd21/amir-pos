import { Prisma } from '@prisma/client';
import { getSetting } from '../modules/settings/service';
import { recordAudit } from './audit';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-settle commissions after goods come back (return or exchange).
 *
 * Commission follows a per-employee DAILY threshold: an earner is paid only on
 * the portion of their own sales for a business day ABOVE their
 * `commissionThreshold`, spread proportionally across that day's bills. A return
 * lowers the day's base, which shifts the factor for EVERY bill that day — so we
 * re-settle the earner's whole business day, not just the returned sale.
 *
 * This helper only *adjusts existing* commission rows (creating brand-new ones
 * for never-calculated sales stays the payroll job's responsibility). Amounts
 * already **paid** are locked: the difference is written as a single **pending
 * adjustment** (negative if the earner was over-paid for goods since returned),
 * so net of (paid + pending) always equals the new target.
 */
export async function reconcileCommissionsForSale(
  tx: Prisma.TransactionClient,
  saleId: number,
  actorUserId: number,
  branchId: number
): Promise<void> {
  // Only act if this sale already has commission rows — otherwise the day
  // hasn't been calculated and payroll will net the return when it runs.
  const seed = await tx.commission.findMany({ where: { saleId } });
  if (seed.length === 0) return;

  const mode = await getSetting<string>('commissionMode', 'item_level');

  const s0 = await tx.sale.findUnique({
    where: { id: saleId },
    select: { businessDate: true, createdAt: true },
  });
  if (!s0) return;

  // The sale's business day (store-wide, matching how calculateCommissions
  // groups — no branch split, since the threshold is per employee per day).
  const dayStr = (s0.businessDate ?? s0.createdAt).toISOString().slice(0, 10);
  const dayStart = new Date(`${dayStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dayStr}T23:59:59.999Z`);

  // Every commissionable sale for that business day (completed + partially
  // returned — the latter's still-sold items keep earning).
  const daySales = await tx.sale.findMany({
    where: {
      status: { in: ['completed', 'partially_returned'] },
      OR: [
        { businessDate: dayStart },
        { businessDate: null, createdAt: { gte: dayStart, lte: dayEnd } },
      ],
    },
    include: {
      user: { select: { id: true, commissionRate: true, commissionThreshold: true } },
      items: { include: { agent: { select: { id: true, commissionRate: true, commissionThreshold: true } } } },
      returns: { select: { total: true } },
    },
  });

  // Per (sale, employee) live base, and per employee day base / threshold / rate.
  type Bill = { saleId: number; userId: number; base: number; rate: number };
  const bills: Bill[] = [];
  const dayBase = new Map<number, number>();
  const threshold = new Map<number, number>();
  const rateOf = new Map<number, number>();

  for (const sale of daySales) {
    if (mode === 'bill_level') {
      const refunded = sale.returns.reduce((s, r) => s + Number(r.total), 0);
      const netTotal = Math.max(0, Number(sale.total) - refunded);
      const rate = Number(sale.user.commissionRate);
      if (rate <= 0 || netTotal <= 0) continue;
      bills.push({ saleId: sale.id, userId: sale.userId, base: netTotal, rate });
      dayBase.set(sale.userId, (dayBase.get(sale.userId) ?? 0) + netTotal);
      threshold.set(sale.userId, Number(sale.user.commissionThreshold) || 0);
      rateOf.set(sale.userId, rate);
    } else {
      const agentTotals = new Map<number, number>();
      for (const item of sale.items) {
        if (!item.agentId || !item.agent) continue;
        const live = item.quantity - item.returnedQuantity;
        if (live <= 0) continue;
        agentTotals.set(
          item.agentId,
          (agentTotals.get(item.agentId) ?? 0) + Number(item.total) * (live / item.quantity)
        );
      }
      for (const [agentId, base] of agentTotals) {
        const agent = sale.items.find((i) => i.agentId === agentId)?.agent;
        const rate = Number(agent?.commissionRate ?? 0);
        if (rate <= 0) continue;
        bills.push({ saleId: sale.id, userId: agentId, base, rate });
        dayBase.set(agentId, (dayBase.get(agentId) ?? 0) + base);
        threshold.set(agentId, Number(agent?.commissionThreshold) || 0);
        rateOf.set(agentId, rate);
      }
    }
  }

  // Threshold-adjusted target per (sale, employee): only the day's sales above
  // the employee's threshold earn, spread in proportion to each bill's base.
  const targetOf = new Map<string, number>();
  for (const b of bills) {
    const base = dayBase.get(b.userId) ?? 0;
    const thr = threshold.get(b.userId) ?? 0;
    const factor = base > 0 ? Math.max(0, base - thr) / base : 0;
    targetOf.set(`${b.saleId}-${b.userId}`, round2(b.base * factor * (b.rate / 100)));
  }

  // Reconcile existing rows for the whole day (a return shifted every bill's
  // share) plus the returned sale itself (it may now be fully returned and thus
  // absent from daySales, in which case its target is 0 → claw back).
  const scopeSaleIds = Array.from(new Set([...daySales.map((s) => s.id), saleId]));
  const existing = await tx.commission.findMany({ where: { saleId: { in: scopeSaleIds } } });

  const groups = new Map<string, typeof existing>();
  for (const c of existing) {
    const key = `${c.saleId}-${c.userId}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  for (const [key, rows] of groups) {
    const [sid, uid] = key.split('-').map(Number);
    const paidSum = round2(
      rows.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)
    );
    const pendingRows = rows.filter((r) => r.status === 'pending');
    const pendingSum = round2(pendingRows.reduce((s, r) => s + Number(r.amount), 0));
    const target = targetOf.get(key) ?? 0;
    const rate = rateOf.get(uid) ?? Number(rows[0]?.rate ?? 0);
    const desiredPending = round2(target - paidSum);

    // Already correct (one pending row that matches, or nothing to change).
    if (desiredPending === pendingSum && pendingRows.length <= 1) continue;

    if (pendingRows.length > 0) {
      await tx.commission.deleteMany({ where: { id: { in: pendingRows.map((r) => r.id) } } });
    }
    if (desiredPending !== 0) {
      const today = new Date();
      await tx.commission.create({
        data: {
          userId: uid,
          saleId: sid,
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
      entityId: key,
      userId: actorUserId,
      branchId,
      data: { paidSum, previousPending: pendingSum, target, newPending: desiredPending },
    });
  }
}
