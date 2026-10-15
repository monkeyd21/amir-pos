/**
 * The dashboard's numbers against a real database, fed through the real
 * checkout, refund and exchange paths (not hand-made rows), so the test
 * checks what the owner would actually see after a day of trading.
 */
import { describeDb, makeFixture, prisma } from './helpers';
import { posService } from '../modules/pos/service';
import { salesService } from '../modules/sales/service';
import { getDashboard } from '../modules/dashboard/service';
import { dateOnly, istToday } from '../utils/ist';

const TODAY = istToday();

async function setup() {
  const f = await makeFixture(20);
  await prisma.posSession.create({
    data: { userId: f.userId, branchId: f.branchId, openingAmount: 1000, status: 'open', businessDate: dateOnly(TODAY) },
  });
  const owner = await prisma.user.create({
    data: { branchId: f.branchId, email: `owner-${f.branchId}@example.com`, passwordHash: 'x', firstName: 'Owner', role: 'owner' },
  });
  const agent = await prisma.user.create({
    data: { branchId: f.branchId, email: `agent-${f.branchId}@example.com`, passwordHash: 'x', firstName: 'Nazia', role: 'staff' },
  });
  // A second article whose product never had a cost entered, to exercise
  // cost coverage. (A variant with no cost of its own inherits its product's.)
  const base = await prisma.product.findUniqueOrThrow({ where: { id: f.productId } });
  const noCostProduct = await prisma.product.create({
    data: {
      brandId: base.brandId,
      categoryId: base.categoryId,
      name: `Mint dupatta ${f.branchId}`,
      slug: `mint-dupatta-${f.branchId}`,
      basePrice: 1000,
      costPrice: 0,
    },
  });
  const v2 = await prisma.productVariant.create({
    data: {
      productId: noCostProduct.id,
      sku: `NOCOST-${f.branchId}`,
      barcode: `NOCOST-${f.branchId}`,
      size: '26',
      color: 'Mint',
      priceOverride: 1000,
      mrpOverride: 1200,
      costOverride: null,
    },
  });
  await prisma.product.update({ where: { id: f.productId }, data: { costPrice: 800 } });
  await prisma.inventory.create({ data: { variantId: v2.id, branchId: f.branchId, quantity: 5 } });
  const main = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.variantId } });
  return { f, owner, agent, main, v2 };
}

let ref = 0;
async function bill(
  ctx: Awaited<ReturnType<typeof setup>>,
  barcodes: string[],
  pay: { method: string; amount: number }[],
  extra: Record<string, unknown> = {}
) {
  const { sale } = await posService.checkout(
    {
      items: barcodes.map((barcode) => ({ barcode, quantity: 1, agentId: ctx.agent.id })),
      clientRef: `dash-${ctx.f.branchId}-${++ref}`,
      payments: pay,
      ...extra,
    } as any,
    ctx.f.userId,
    ctx.f.branchId
  );
  return sale;
}

describeDb('dashboard numbers', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('nets refunds and exchanges, and computes margin over costed sales only', async () => {
    const ctx = await setup();
    // Main article: charged 1450, cost 800 (product cost; the variant has none).
    // Bill A: two main pieces, cash.            gross 2900
    // Bill B: one no-cost piece, UPI.           gross 1000
    const a = await bill(ctx, [ctx.main.barcode, ctx.main.barcode], [{ method: 'cash', amount: 2900 }]);
    await bill(ctx, [ctx.v2.barcode], [{ method: 'upi', amount: 1000 }]);

    // Refund one main piece from bill A (−1450, profit 650 given back).
    const lineA = await prisma.saleItem.findFirstOrThrow({ where: { saleId: a.id } });
    await salesService.processReturn(
      a.id,
      { items: [{ saleItemId: lineA.id, quantity: 1, condition: 'resellable' }], reasonCode: 'size_issue', refundMode: 'cash' },
      ctx.f.userId,
      ctx.f.branchId,
      'cashier'
    );

    const d: any = await getDashboard({ userId: ctx.owner.id, role: 'owner', branchId: ctx.f.branchId }, { period: 'today' });

    expect(d.sales.bills).toBe(2);
    expect(d.sales.totalSales).toBe(2900 + 1000 - 1450);
    // Costed: 2900 − 1450 = 1450 of sales, cost 1600 − 800 = 800. Profit 650.
    expect(d.profit.grossProfit).toBe(650);
    expect(d.profit.costedSales).toBe(1450);
    expect(d.profit.marginPct).toBe(44.8);
    // Coverage is value-weighted: 1450 costed of 2450 sold.
    expect(d.profit.coveragePct).toBe(59.2);
    expect(d.profit.coverageLevel).toBe('red');
    expect(d.returns).toMatchObject({ count: 1, value: 1450, topReasons: [{ code: 'size_issue', label: 'Size issue', count: 1 }] });
    expect(d.basket.items).toBe(3);
    expect(d.paymentSplit.map((p: any) => p.mode)).toEqual(['cash', 'upi']);
    expect(d.inventorySold.valueAtCost).toBe(800);
    expect(d.staff.lines[0]).toMatchObject({ name: 'Nazia', bills: 2, items: 3 });
  });

  it('counts a POS exchange as one bill worth the difference', async () => {
    const ctx = await setup();
    const orig = await bill(ctx, [ctx.v2.barcode], [{ method: 'cash', amount: 1000 }]);
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: orig.id } });
    // Swap the 1000 piece for a 1450 piece: the customer pays 450.
    await bill(ctx, [ctx.main.barcode], [{ method: 'cash', amount: 450 }], {
      exchange: {
        originalSaleId: orig.id,
        returnItems: [{ saleItemId: line.id, quantity: 1, condition: 'resellable' }],
        reasonCode: 'colour_mismatch',
      },
    });

    const d: any = await getDashboard({ userId: ctx.owner.id, role: 'owner', branchId: ctx.f.branchId }, { period: 'today' });
    expect(d.sales.bills).toBe(2);
    expect(d.sales.totalSales).toBe(1450);
    expect(d.returns.count).toBe(0);
    expect(d.returns.exchanges).toBe(1);
    expect(d.recentTransactions[0]).toMatchObject({ badge: 'exchange', amount: 450 });
  });

  it('tells identified new and returning customers apart, and only counts walk-ins', async () => {
    const ctx = await setup();
    const regular = await prisma.customer.create({ data: { firstName: 'Ayesha', phone: `98${String(ctx.f.branchId).padStart(8, '0')}` } });
    const newbie = await prisma.customer.create({ data: { firstName: 'Neha', phone: `97${String(ctx.f.branchId).padStart(8, '0')}` } });
    // Ayesha bought last month.
    await prisma.sale.create({
      data: {
        branchId: ctx.f.branchId,
        userId: ctx.f.userId,
        customerId: regular.id,
        saleNumber: `OLD-${ctx.f.branchId}`,
        subtotal: 500,
        taxAmount: 0,
        total: 500,
        businessDate: new Date(dateOnly(TODAY).getTime() - 30 * 86400_000),
      },
    });
    await bill(ctx, [ctx.v2.barcode], [{ method: 'upi', amount: 1000 }], { customerId: regular.id });
    await bill(ctx, [ctx.v2.barcode], [{ method: 'upi', amount: 1000 }], { customerId: newbie.id });
    await bill(ctx, [ctx.v2.barcode], [{ method: 'cash', amount: 1000 }]);

    const d: any = await getDashboard({ userId: ctx.owner.id, role: 'owner', branchId: ctx.f.branchId }, { period: 'today' });
    expect(d.customers).toMatchObject({ identified: 2, returning: 1, returningPct: 50, walkIns: 1 });
  });

  it('gives a cashier only their own basket and nothing store-wide (§11A)', async () => {
    const ctx = await setup();
    await bill(ctx, [ctx.main.barcode], [{ method: 'cash', amount: 1450 }]);
    const other = await prisma.user.create({
      data: { branchId: ctx.f.branchId, email: `c2-${ctx.f.branchId}@example.com`, passwordHash: 'x', firstName: 'C2', role: 'cashier' },
    });

    const mine: any = await getDashboard({ userId: ctx.f.userId, role: 'cashier', branchId: ctx.f.branchId }, { period: 'today' });
    expect(mine.sales).toBeUndefined();
    expect(mine.profit).toBeUndefined();
    expect(mine.paymentSplit).toBeUndefined();
    expect(mine.alerts).toBeUndefined();
    expect(mine.basket).toMatchObject({ items: 1, ownOnly: true });

    const theirs: any = await getDashboard({ userId: other.id, role: 'cashier', branchId: ctx.f.branchId }, { period: 'today' });
    expect(theirs.basket.items).toBe(0);
    expect(theirs.recentTransactions).toEqual([]);
  });

  it('shows a supervisor sales on Today only, and never profit', async () => {
    const ctx = await setup();
    await bill(ctx, [ctx.main.barcode], [{ method: 'cash', amount: 1450 }]);
    const sup = { userId: ctx.f.userId, role: 'supervisor', branchId: ctx.f.branchId };

    const today: any = await getDashboard(sup, { period: 'today' });
    expect(today.sales.totalSales).toBe(1450);
    expect(today.profit).toBeUndefined();

    const week: any = await getDashboard(sup, { period: 'week' });
    expect(week.sales).toBeUndefined();
    expect(week.basket).toBeDefined();
  });

  it('shows Cash in Drawer only once the shift is closed', async () => {
    const ctx = await setup();
    await bill(ctx, [ctx.main.barcode], [{ method: 'cash', amount: 1450 }]);
    const owner = { userId: ctx.owner.id, role: 'owner', branchId: ctx.f.branchId };

    expect(((await getDashboard(owner, { period: 'today' })) as any).eod).toBeNull();

    // Opening 1000 + cash 1450 = 2450 expected; 2400 counted is ₹50 short (2%).
    await posService.finalizeCloseSession(ctx.f.userId, { closingAmount: 2400 }, ctx.f.branchId).catch(async (e) => {
      // A ₹50 variance meets the default PIN threshold; the shop's PIN is the default here.
      if (/Owner PIN/.test(String(e?.message))) {
        return posService.finalizeCloseSession(
          ctx.f.userId,
          { closingAmount: 2400, ownerPin: '1234', cashVarianceReason: 'Change given wrong' },
          ctx.f.branchId
        );
      }
      throw e;
    });

    const d: any = await getDashboard(owner, { period: 'today' });
    expect(d.eod).toMatchObject({ expected: 2450, counted: 2400, variance: -50, status: 'short', cashSales: 1450 });
    expect(d.eod.tier).toBe('good');
  });
});
