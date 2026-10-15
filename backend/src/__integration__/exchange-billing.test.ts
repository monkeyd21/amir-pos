/**
 * Exchanges bill the replacement goods, whichever screen starts them.
 *
 * `POST /sales/:id/exchange` used to move stock both ways and record no bill
 * and no money for the replacement. It now settles through checkout like the
 * POS exchange. These run the real code paths against a real database.
 */
import bcrypt from 'bcryptjs';
import { describeDb, makeFixture, prisma } from './helpers';
import { posService } from '../modules/pos/service';
import { salesService } from '../modules/sales/service';
import { legacyExchange } from '../modules/sales/legacy-exchange';
import { approveExchangeOverride } from '../services/exchange-override';
import { dateOnly, istToday } from '../utils/ist';

const stock = async (variantId: number, branchId: number) =>
  (await prisma.inventory.findUniqueOrThrow({ where: { variantId_branchId: { variantId, branchId } } })).quantity;

async function setup() {
  const f = await makeFixture(10);
  await prisma.posSession.create({
    data: { userId: f.userId, branchId: f.branchId, openingAmount: 0, status: 'open', businessDate: dateOnly(istToday()) },
  });
  const main = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.variantId } });
  // A cheaper piece to start with, so the swap costs the customer the difference.
  const cheap = await prisma.productVariant.create({
    data: {
      productId: f.productId,
      sku: `CHEAP-${f.branchId}`,
      barcode: `CHEAP-${f.branchId}`,
      size: '22',
      color: 'Mint',
      priceOverride: 1000,
      mrpOverride: 1200,
    },
  });
  await prisma.inventory.create({ data: { variantId: cheap.id, branchId: f.branchId, quantity: 5 } });
  const { sale } = await posService.checkout(
    { items: [{ barcode: cheap.barcode, quantity: 1 }], payments: [{ method: 'upi', amount: 1000 }], clientRef: `orig-${f.branchId}` },
    f.userId,
    f.branchId
  );
  const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
  return { f, main, cheap, orig: sale, line };
}

const swapBody = (line: { id: number }, barcode: string, extra: Record<string, unknown> = {}) => ({
  returnItems: [{ saleItemId: line.id, quantity: 1, condition: 'resellable' as const }],
  newItems: [{ barcode, quantity: 1 }],
  reasonCode: 'size_issue',
  ...extra,
});

describeDb('exchange billing', () => {
  afterAll(async () => prisma.$disconnect());

  it('bills the replacement and records the difference, from the older app endpoint', async () => {
    const { f, main, cheap, orig, line } = await setup();

    const res = await legacyExchange(orig.id, swapBody(line, main.barcode), f.userId, f.branchId);

    // 1450 replacement against 1000 credit: the customer paid 450.
    expect(res.priceDifference).toBe(450);
    const bill = await prisma.sale.findUniqueOrThrow({ where: { id: res.sale.id }, include: { payments: true } });
    expect(Number(bill.total)).toBe(1450);
    expect(Number(bill.exchangeCreditAmount)).toBe(1000);
    expect(bill.exchangeReturnId).not.toBeNull();
    expect(bill.payments.map((p) => [p.method, Number(p.amount)])).toEqual([['cash', 450]]);

    const ret = await prisma.return.findUniqueOrThrow({ where: { id: bill.exchangeReturnId! } });
    expect(ret).toMatchObject({ type: 'exchange', reasonCode: 'size_issue' });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: orig.id } })).status).toBe('returned');
    expect(await stock(main.id, f.branchId)).toBe(9);
    expect(await stock(cheap.id, f.branchId)).toBe(5); // 5 − 1 sold + 1 back

    const audit = await prisma.auditLog.findFirst({ where: { action: 'exchange.legacy_endpoint', entityId: String(bill.id) } });
    expect(audit).not.toBeNull();
  });

  it('quotes exactly what the exchange then charges, and writes nothing', async () => {
    const { f, main, orig, line } = await setup();
    const before = await prisma.sale.count({ where: { branchId: f.branchId } });

    const q = await posService.quote(
      {
        items: [{ barcode: main.barcode, quantity: 1 }],
        payments: [],
        exchange: { originalSaleId: orig.id, returnItems: [{ saleItemId: line.id, quantity: 1, condition: 'resellable' }] },
      },
      f.userId,
      f.branchId
    );
    expect(q).toMatchObject({ saleTotal: 1450, exchangeCredit: 1000, amountDue: 450, refundDue: 0 });
    expect(await prisma.sale.count({ where: { branchId: f.branchId } })).toBe(before);
    expect(await prisma.return.count({ where: { originalSaleId: orig.id } })).toBe(0);
    expect(await stock(main.id, f.branchId)).toBe(10);
  });

  it('keeps the exchange on a bill that was only refunded against', async () => {
    const { f, main, cheap } = await setup();
    const { sale } = await posService.checkout(
      { items: [{ barcode: cheap.barcode, quantity: 2 }], payments: [{ method: 'cash', amount: 2000 }], clientRef: `two-${f.branchId}` },
      f.userId,
      f.branchId
    );
    const l = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    await salesService.processReturn(
      sale.id,
      { items: [{ saleItemId: l.id, quantity: 1, condition: 'resellable' }], reasonCode: 'changed_mind', refundMode: 'cash' },
      f.userId,
      f.branchId,
      'cashier'
    );
    // A refund is not an exchange: the swap still goes through.
    await expect(legacyExchange(sale.id, swapBody(l, main.barcode), f.userId, f.branchId)).resolves.toBeDefined();
  });

  it('refuses a second exchange on the same bill and names the earlier one', async () => {
    const { f, main, cheap } = await setup();
    const { sale } = await posService.checkout(
      { items: [{ barcode: cheap.barcode, quantity: 2 }], payments: [{ method: 'cash', amount: 2000 }], clientRef: `pair1-${f.branchId}` },
      f.userId,
      f.branchId
    );
    const l = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    await legacyExchange(sale.id, swapBody(l, main.barcode), f.userId, f.branchId);
    await expect(legacyExchange(sale.id, swapBody(l, main.barcode), f.userId, f.branchId)).rejects.toThrow(/one exchange per bill/i);
    expect(await prisma.return.count({ where: { originalSaleId: sale.id } })).toBe(1);
  });

  it('lets a second exchange through on a manager approval, and records who approved', async () => {
    const { f, main, cheap } = await setup();
    const manager = await prisma.user.create({
      data: {
        branchId: f.branchId,
        email: `mgr-${f.branchId}@example.com`,
        passwordHash: await bcrypt.hash('pw-123456', 4),
        firstName: 'Farhan',
        role: 'manager',
      },
    });
    const { sale } = await posService.checkout(
      { items: [{ barcode: cheap.barcode, quantity: 2 }], payments: [{ method: 'cash', amount: 2000 }], clientRef: `pair-${f.branchId}` },
      f.userId,
      f.branchId
    );
    const l = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    await legacyExchange(sale.id, swapBody(l, main.barcode), f.userId, f.branchId);
    await expect(legacyExchange(sale.id, swapBody(l, main.barcode), f.userId, f.branchId)).rejects.toThrow();

    const approval = await approveExchangeOverride(sale.id, manager.email!, 'pw-123456');
    const second = await legacyExchange(
      sale.id,
      swapBody(l, main.barcode, { overrideGrant: approval.grant }),
      f.userId,
      f.branchId
    );
    const ret = await prisma.return.findUniqueOrThrow({
      where: { id: (await prisma.sale.findUniqueOrThrow({ where: { id: second.sale.id } })).exchangeReturnId! },
    });
    expect(ret.approvedBy).toBe(manager.id);
  });

  it('refuses an exchange against a bill that does not exist', async () => {
    const { f, main, line } = await setup();
    await expect(legacyExchange(999999999, swapBody(line, main.barcode), f.userId, f.branchId)).rejects.toThrow(/not found/i);
  });
});
