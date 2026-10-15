/**
 * Dashboard spec foundations, against a real database:
 *  - checkout snapshots the landed cost onto each line (§3.1 / §12.3);
 *  - the P&L reads that snapshot, so a later cost edit cannot rewrite history;
 *  - a refund carries a fixed reason code and the trading day it happened on
 *    (§5.2 / §12.2), and free text is refused.
 */
import { describeDb, makeFixture, prisma } from './helpers';
import { posService } from '../modules/pos/service';
import { salesService } from '../modules/sales/service';
import { reportService } from '../modules/reports/service';
import { dateOnly, istToday } from '../utils/ist';

// Today's trading day: an unclosed shift from an EARLIER day refuses to bill
// after 4 am, which is correct, and not what these tests are about.
const TODAY = istToday();
const SHIFT_DAY = dateOnly(TODAY);

async function openShift(userId: number, branchId: number) {
  return prisma.posSession.create({
    data: { userId, branchId, openingAmount: 0, status: 'open', businessDate: SHIFT_DAY },
  });
}

async function sellOne(f: { userId: number; branchId: number; variantId: number }) {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.variantId } });
  const { sale } = await posService.checkout(
    {
      items: [{ barcode: variant.barcode, quantity: 1 }],
      clientRef: `fnd-${f.variantId}-${Date.now()}`,
      payments: [{ method: 'cash', amount: 1450 }],
    },
    f.userId,
    f.branchId
  );
  return sale;
}

describeDb('dashboard foundations', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('snapshots the landed cost at checkout, preferring landing over purchase cost', async () => {
    const f = await makeFixture(5);
    await prisma.productVariant.update({ where: { id: f.variantId }, data: { landingOverride: 875 } });
    await openShift(f.userId, f.branchId);

    const sale = await sellOne(f);
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });

    expect(Number(line.unitCost)).toBe(875);
  });

  it('records no cost (not zero) for an article that never had one', async () => {
    const f = await makeFixture(5);
    await prisma.product.update({ where: { id: f.productId }, data: { costPrice: 0 } });
    await openShift(f.userId, f.branchId);

    const sale = await sellOne(f);
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });

    expect(line.unitCost).toBeNull();
  });

  it('keeps P&L profit at the cost the piece was sold at, after the cost is edited', async () => {
    const f = await makeFixture(5);
    await openShift(f.userId, f.branchId);
    await sellOne(f); // cost 800, charged 1450

    await prisma.product.update({ where: { id: f.productId }, data: { costPrice: 1200 } });

    const pnl = await reportService.getPnlReport({
      startDate: TODAY,
      endDate: TODAY,
      branchId: String(f.branchId),
    });
    expect(pnl.totals.profitLoss).toBe(650);
  });

  it('gives a refund its reason code, label and the shift trading day', async () => {
    const f = await makeFixture(5);
    await openShift(f.userId, f.branchId);
    const sale = await sellOne(f);
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });

    await salesService.processReturn(
      sale.id,
      {
        items: [{ saleItemId: line.id, quantity: 1, condition: 'resellable' }],
        reasonCode: 'colour_mismatch',
        refundMode: 'cash',
      },
      f.userId,
      f.branchId,
      'cashier'
    );

    const row = await prisma.return.findFirstOrThrow({ where: { originalSaleId: sale.id } });
    expect(row.reasonCode).toBe('colour_mismatch');
    expect(row.reason).toBe('Colour mismatch');
    expect(row.businessDate?.toISOString().slice(0, 10)).toBe(TODAY);
  });

  it('refuses a refund with a free-text reason and writes nothing', async () => {
    const f = await makeFixture(5);
    await openShift(f.userId, f.branchId);
    const sale = await sellOne(f);
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });

    await expect(
      salesService.processReturn(
        sale.id,
        {
          items: [{ saleItemId: line.id, quantity: 1, condition: 'resellable' }],
          reason: 'too tight',
          refundMode: 'cash',
        },
        f.userId,
        f.branchId,
        'cashier'
      )
    ).rejects.toThrow(/return reason/i);
    expect(await prisma.return.count({ where: { originalSaleId: sale.id } })).toBe(0);
  });
});
