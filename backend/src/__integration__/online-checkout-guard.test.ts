/**
 * §shop-guard — the single most important regression test in this project.
 *
 * `topUpShortfall()` silently manufactures stock so a counter sale is never
 * dead-ended by a wrong count. That is right at the till and catastrophic on
 * the web: it would take a shopper's money for a garment already sold and leave
 * nothing to ship.
 *
 * If this file starts failing, someone has reintroduced the ability to
 * oversell online. A comment in the source is not sufficient protection, which
 * is why these assertions exist.
 */
import { describeDb, makeFixture, prisma } from './helpers';
import { posService } from '../modules/pos/service';
import { getShopSystemUserId, resetShopSystemUserCache } from '../modules/shop/system-user';

async function openSession(userId: number, branchId: number) {
  return prisma.posSession.create({
    data: {
      userId,
      branchId,
      openingAmount: 0,
      status: 'open',
      businessDate: new Date(),
    },
  });
}

describeDb('online checkout guard', () => {
  afterAll(async () => {
    resetShopSystemUserCache();
    await prisma.$disconnect();
  });

  it('REFUSES an online sale when stock cannot cover it', async () => {
    const f = await makeFixture(0);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: f.variantId },
    });
    const systemUserId = await getShopSystemUserId();

    await expect(
      posService.checkout(
        {
          items: [{ barcode: variant.barcode, quantity: 1 }],
          channel: 'online',
          clientRef: `guard-${Date.now()}`,
          payments: [{ method: 'upi', amount: 1450 }],
        },
        systemUserId,
        f.branchId
      )
    ).rejects.toThrow(/sold out/i);
  });

  it('does NOT invent stock for a refused online sale', async () => {
    const f = await makeFixture(0);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: f.variantId },
    });
    const systemUserId = await getShopSystemUserId();

    await posService
      .checkout(
        {
          items: [{ barcode: variant.barcode, quantity: 1 }],
          channel: 'online',
          clientRef: `guard-noinvent-${Date.now()}`,
          payments: [{ method: 'upi', amount: 1450 }],
        },
        systemUserId,
        f.branchId
      )
      .catch(() => undefined);

    // Stock untouched — no phantom `adjustment` stock-in.
    const inv = await prisma.inventory.findUnique({
      where: { variantId_branchId: { variantId: f.variantId, branchId: f.branchId } },
    });
    expect(inv?.quantity).toBe(0);

    const movements = await prisma.inventoryMovement.count({
      where: { variantId: f.variantId, type: 'adjustment' },
    });
    expect(movements).toBe(0);

    // And crucially: no Sale was written. The books stay clean.
    const sales = await prisma.sale.count({ where: { branchId: f.branchId } });
    expect(sales).toBe(0);
  });

  it('still tops up a COUNTER sale, because the cashier is holding the garment', async () => {
    const f = await makeFixture(0);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: f.variantId },
    });
    await openSession(f.userId, f.branchId);

    const result = await posService.checkout(
      {
        items: [{ barcode: variant.barcode, quantity: 1 }],
        channel: 'walkin',
        clientRef: `counter-${Date.now()}`,
        payments: [{ method: 'cash', amount: 5000 }],
      },
      f.userId,
      f.branchId
    );

    expect(result.sale.id).toBeGreaterThan(0);
    // The shortfall was covered and the count landed at zero, not negative.
    const inv = await prisma.inventory.findUnique({
      where: { variantId_branchId: { variantId: f.variantId, branchId: f.branchId } },
    });
    expect(inv?.quantity).toBe(0);
    // ...and the correction is auditable.
    const adjustments = await prisma.inventoryMovement.count({
      where: { variantId: f.variantId, type: 'adjustment' },
    });
    expect(adjustments).toBeGreaterThan(0);
  });

  it('completes an online sale when the stock is really there', async () => {
    const f = await makeFixture(1);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: f.variantId },
    });
    const systemUserId = await getShopSystemUserId();

    const result = await posService.checkout(
      {
        items: [{ barcode: variant.barcode, quantity: 1 }],
        channel: 'online',
        clientRef: `ok-${Date.now()}`,
        payments: [{ method: 'upi', amount: 1450 }],
      },
      systemUserId,
      f.branchId
    );

    expect(result.sale.channel).toBe('online');
    // Online bills take their own sequence, never interleaved with counter bills.
    expect(result.sale.saleNumber.startsWith('O')).toBe(true);
    // The trading day comes from the wall clock: there is no shift to inherit.
    expect(result.sale.businessDate).not.toBeNull();

    const inv = await prisma.inventory.findUnique({
      where: { variantId_branchId: { variantId: f.variantId, branchId: f.branchId } },
    });
    expect(inv?.quantity).toBe(0);
  });

  it('needs NO open POS session for an online sale', async () => {
    const f = await makeFixture(1);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: f.variantId },
    });
    const systemUserId = await getShopSystemUserId();

    // No session is created for the system user anywhere in this test.
    const open = await prisma.posSession.count({
      where: { userId: systemUserId, status: 'open' },
    });
    expect(open).toBe(0);

    await expect(
      posService.checkout(
        {
          items: [{ barcode: variant.barcode, quantity: 1 }],
          channel: 'online',
          clientRef: `nosession-${Date.now()}`,
          payments: [{ method: 'upi', amount: 1450 }],
        },
        systemUserId,
        f.branchId
      )
    ).resolves.toBeDefined();
  });

  it('is idempotent: a replayed webhook cannot double-bill', async () => {
    const f = await makeFixture(2);
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: f.variantId },
    });
    const systemUserId = await getShopSystemUserId();
    const clientRef = `idem-${Date.now()}`;

    const first = await posService.checkout(
      {
        items: [{ barcode: variant.barcode, quantity: 1 }],
        channel: 'online',
        clientRef,
        payments: [{ method: 'upi', amount: 1450 }],
      },
      systemUserId,
      f.branchId
    );

    const second = await posService.checkout(
      {
        items: [{ barcode: variant.barcode, quantity: 1 }],
        channel: 'online',
        clientRef,
        payments: [{ method: 'upi', amount: 1450 }],
      },
      systemUserId,
      f.branchId
    );

    expect(second.sale.id).toBe(first.sale.id);
    expect(second.idempotent).toBe(true);

    // One unit sold, not two.
    const inv = await prisma.inventory.findUnique({
      where: { variantId_branchId: { variantId: f.variantId, branchId: f.branchId } },
    });
    expect(inv?.quantity).toBe(1);
  });
});
