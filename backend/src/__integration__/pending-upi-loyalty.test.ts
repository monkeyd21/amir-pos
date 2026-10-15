/**
 * Pending sales (§15.5), UPI credit matching (§15.2) and loyalty expiry
 * (§8 #3), against a real database.
 */
import { describeDb, makeFixture, prisma } from './helpers';
import { pendingSaleService } from '../modules/pending-sales/service';
import { upiCreditService } from '../modules/upi-credits/service';
import { posService } from '../modules/pos/service';
import { expireDuePoints, expiringSoon } from '../modules/loyalty/expiry';
import { dateOnly, istToday } from '../utils/ist';

const TODAY = istToday();
const stock = async (variantId: number, branchId: number) =>
  (await prisma.inventory.findUniqueOrThrow({ where: { variantId_branchId: { variantId, branchId } } })).quantity;

async function setup(qty = 5) {
  const f = await makeFixture(qty);
  const owner = await prisma.user.create({
    data: { branchId: f.branchId, email: `own-${f.branchId}@example.com`, passwordHash: 'x', firstName: 'Owner', role: 'owner' },
  });
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.variantId } });
  return { f, owner, barcode: v.barcode };
}

describeDb('pending sales', () => {
  afterAll(async () => prisma.$disconnect());

  it('takes the stock off at capture, and only once when finalised on the original day', async () => {
    const { f, owner, barcode } = await setup(5);
    // Captured "yesterday": the staff member's shift was yesterday's.
    const yesterday = dateOnly(new Date(Date.parse(TODAY) - 86400_000).toISOString().slice(0, 10));
    await prisma.posSession.create({
      data: { userId: f.userId, branchId: f.branchId, openingAmount: 0, status: 'open', businessDate: yesterday },
    });

    const p = await pendingSaleService.capture(
      { items: [{ barcode, quantity: 2 }], paymentMode: 'cash', amountReceived: 2900 },
      f.userId,
      f.branchId
    );
    expect(p.number).toMatch(/^PS\d{4}$/);
    expect(p.businessDate.toISOString().slice(0, 10)).toBe(yesterday.toISOString().slice(0, 10));
    expect(await stock(f.variantId, f.branchId)).toBe(3);

    const { sale } = await pendingSaleService.finalize(p.id, {}, owner.id, f.branchId);
    expect(sale.businessDate?.toISOString().slice(0, 10)).toBe(yesterday.toISOString().slice(0, 10));
    expect(Number(sale.total)).toBe(2900);
    expect(await stock(f.variantId, f.branchId)).toBe(3); // not deducted again
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(line.agentId).toBe(f.userId); // the person who handed it over sold it

    // Finalising twice cannot bill twice.
    await expect(pendingSaleService.finalize(p.id, {}, owner.id, f.branchId)).rejects.toThrow(/already finalized/);
    expect(await prisma.sale.count({ where: { clientRef: `pending-sale-${p.id}` } })).toBe(1);
  });

  it('puts the stock back on void, and refuses to finalise a voided one', async () => {
    const { f, owner, barcode } = await setup(5);
    const p = await pendingSaleService.capture(
      { items: [{ barcode, quantity: 1 }], paymentMode: 'upi', amountReceived: 1450 },
      f.userId,
      f.branchId
    );
    expect(await stock(f.variantId, f.branchId)).toBe(4);
    await pendingSaleService.void(p.id, 'Customer brought it back before paying', owner.id, f.branchId);
    expect(await stock(f.variantId, f.branchId)).toBe(5);
    await expect(pendingSaleService.finalize(p.id, {}, owner.id, f.branchId)).rejects.toThrow(/already voided/);
  });

  it('syncs an offline capture once', async () => {
    const { f, barcode } = await setup(5);
    const input = { items: [{ barcode, quantity: 1 }], paymentMode: 'cash' as const, amountReceived: 1450, clientRef: `off-${f.branchId}` };
    const a = await pendingSaleService.capture(input, f.userId, f.branchId);
    const b = await pendingSaleService.capture(input, f.userId, f.branchId);
    expect(b.id).toBe(a.id);
    expect(await stock(f.variantId, f.branchId)).toBe(4);
  });

  it('refuses free-text articles', async () => {
    const { f } = await setup(5);
    await expect(
      pendingSaleService.capture({ items: [{ barcode: 'red kurti', quantity: 1 }], paymentMode: 'cash', amountReceived: 500 }, f.userId, f.branchId)
    ).rejects.toThrow(/Not found/);
  });
});

describeDb('UPI credits', () => {
  it('imports once, auto-matches the unambiguous credit and leaves the rest', async () => {
    const { f, owner, barcode } = await setup(10);
    await prisma.posSession.create({
      data: { userId: f.userId, branchId: f.branchId, openingAmount: 0, status: 'open', businessDate: dateOnly(TODAY) },
    });
    const { sale } = await posService.checkout(
      { items: [{ barcode, quantity: 1 }], payments: [{ method: 'upi', amount: 1450 }], clientRef: `upi-${f.branchId}` },
      f.userId,
      f.branchId
    );
    const at = sale.createdAt.toISOString();
    const rows = [
      { receivedAt: at, amount: 1450, reference: `UTR${f.branchId}A1` },
      { receivedAt: at, amount: 999, reference: `UTR${f.branchId}B2` },
    ];

    const first = await upiCreditService.import(rows, 'import', owner.id, f.branchId);
    expect(first).toEqual({ added: 2, skipped: 0, autoMatched: 1 });
    const again = await upiCreditService.import(rows, 'import', owner.id, f.branchId);
    expect(again).toMatchObject({ added: 0, skipped: 2 });

    const open = await upiCreditService.list(f.branchId, 'unmatched');
    expect(open.map((c) => Number(c.amount))).toEqual([999]);
    await upiCreditService.markNonSale(open[0].id, 'Owner topped up the account', owner.id, f.branchId);
    expect(await upiCreditService.list(f.branchId, 'unmatched')).toEqual([]);
  });
});

describeDb('loyalty expiry', () => {
  it('spends the oldest points first and expires only what is left of them', async () => {
    const c = await prisma.customer.create({ data: { firstName: 'Ayesha', phone: `96${Date.now().toString().slice(-8)}`, loyaltyPoints: 0 } });
    const past = new Date(Date.now() - 86400_000);
    const soon = new Date(Date.now() + 3 * 86400_000);
    // 100 earned that already lapsed, 50 lapsing in 3 days, 30 redeemed since.
    await prisma.loyaltyTransaction.createMany({
      data: [
        { customerId: c.id, points: 100, type: 'earned', expiresAt: past },
        { customerId: c.id, points: 50, type: 'earned', expiresAt: soon },
        { customerId: c.id, points: -30, type: 'redeemed' },
      ],
    });
    await prisma.customer.update({ where: { id: c.id }, data: { loyaltyPoints: 120 } });

    await expireDuePoints();
    // The 30 spent came out of the oldest 100, so 70 lapse and 50 remain.
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyPoints).toBe(50);
    await expireDuePoints();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyPoints).toBe(50);

    const soonList = await expiringSoon(7);
    expect(soonList.find((x) => x.id === c.id)).toMatchObject({ expiring: 50, balance: 50 });
  });
});
