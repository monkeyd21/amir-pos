/**
 * The reservation engine, against real Postgres.
 *
 * These are the tests that matter most in the whole project: the correctness of
 * the shared-stock design is almost entirely about concurrency, and concurrency
 * cannot be tested against a mocked Prisma client. Each case here is a row of
 * the race matrix in docs/ecommerce/tech-spec.html §4.6.
 */
import { describeDb, makeFixture, prisma } from './helpers';
import {
  availabilityFor,
  availableUnits,
  reserve,
  release,
  assertRawStockCovers,
  expireStaleHolds,
  SoldOutError,
} from '../modules/shop/availability';

const HOLD = 15;

describeDb('stock reservations', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reports raw stock as available when nothing is held', async () => {
    const f = await makeFixture(3);
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(3);
  });

  it('subtracts a live hold from availability', async () => {
    const f = await makeFixture(3);
    await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 2,
        holdMinutes: HOLD,
      })
    );
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(1);
  });

  it('treats a variant with no inventory row as unavailable, not unlimited', async () => {
    const f = await makeFixture(1);
    await prisma.inventory.deleteMany({ where: { variantId: f.variantId } });
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(0);
  });

  // ── The headline race ─────────────────────────────────────────────────────
  it('grants exactly one hold when shoppers race for the last unit', async () => {
    const f = await makeFixture(1);

    const attempts = Array.from({ length: 8 }, () =>
      prisma
        .$transaction((tx) =>
          reserve(tx, {
            variantId: f.variantId,
            branchId: f.branchId,
            quantity: 1,
            holdMinutes: HOLD,
          })
        )
        .then(() => 'won' as const)
        .catch((e) => (e instanceof SoldOutError ? ('lost' as const) : Promise.reject(e)))
    );

    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'lost')).toHaveLength(7);
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(0);
  });

  it('grants exactly three holds when eight shoppers race for three units', async () => {
    const f = await makeFixture(3);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma
          .$transaction((tx) =>
            reserve(tx, {
              variantId: f.variantId,
              branchId: f.branchId,
              quantity: 1,
              holdMinutes: HOLD,
            })
          )
          .then(() => 'won' as const)
          .catch((e) => (e instanceof SoldOutError ? ('lost' as const) : Promise.reject(e)))
      )
    );

    expect(outcomes.filter((o) => o === 'won')).toHaveLength(3);
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(0);
  });

  it('never oversells across mixed quantities', async () => {
    const f = await makeFixture(5);
    const sizes = [3, 3, 2, 2, 1, 1];

    const granted = await Promise.all(
      sizes.map((q) =>
        prisma
          .$transaction((tx) =>
            reserve(tx, {
              variantId: f.variantId,
              branchId: f.branchId,
              quantity: q,
              holdMinutes: HOLD,
            })
          )
          .then(() => q)
          .catch((e) => (e instanceof SoldOutError ? 0 : Promise.reject(e)))
      )
    );

    const total = granted.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(5);
    const avail = await availableUnits(f.variantId, f.branchId);
    expect(avail).toBe(5 - total);
  });

  // ── Lazy expiry ───────────────────────────────────────────────────────────
  it('frees stock the moment a hold lapses, with the sweeper never running', async () => {
    const f = await makeFixture(1);

    // A hold that expired a minute ago; still status 'held' in the table.
    await prisma.stockReservation.create({
      data: {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 1,
        status: 'held',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    // No sweeper has run — availability must already ignore it.
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(1);

    // And a new shopper can take it.
    await expect(
      prisma.$transaction((tx) =>
        reserve(tx, {
          variantId: f.variantId,
          branchId: f.branchId,
          quantity: 1,
          holdMinutes: HOLD,
        })
      )
    ).resolves.toBeDefined();
  });

  it('sweeper only relabels lapsed holds; it does not change availability', async () => {
    const f = await makeFixture(1);
    await prisma.stockReservation.create({
      data: {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 1,
        status: 'held',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const before = await availableUnits(f.variantId, f.branchId);
    await expireStaleHolds();
    const after = await availableUnits(f.variantId, f.branchId);

    expect(before).toBe(1);
    expect(after).toBe(before);
  });

  // ── Editing your own cart line ────────────────────────────────────────────
  it('lets a cart line raise its own quantity without fighting its own hold', async () => {
    const f = await makeFixture(2);

    const first = await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 1,
        holdMinutes: HOLD,
      })
    );

    // Without the exclusion this would see 1 held of 2 and refuse a 2-unit hold.
    const raised = await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 2,
        holdMinutes: HOLD,
        excludeReservationId: first.id,
      })
    );

    expect(raised.quantity).toBe(2);
  });

  it('releasing a hold returns the stock to the shelf', async () => {
    const f = await makeFixture(1);
    const held = await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 1,
        holdMinutes: HOLD,
      })
    );
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(0);

    await prisma.$transaction((tx) => release(tx, held.id));
    await expect(availableUnits(f.variantId, f.branchId)).resolves.toBe(1);
  });

  // ── The payment-time re-check (§4.5) ──────────────────────────────────────
  it('re-check ignores reservations and passes when the goods are physically there', async () => {
    const f = await makeFixture(1);
    await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 1,
        holdMinutes: HOLD,
      })
    );

    // The order's own hold must not make its own confirmation fail.
    await expect(
      prisma.$transaction((tx) =>
        assertRawStockCovers(tx, [{ variantId: f.variantId, quantity: 1 }], f.branchId)
      )
    ).resolves.toBeUndefined();
  });

  it('re-check fails when the counter sold the goods during payment', async () => {
    const f = await makeFixture(1);
    await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: f.variantId,
        branchId: f.branchId,
        quantity: 1,
        holdMinutes: HOLD,
      })
    );

    // A cashier sells the last one while the payment is in flight.
    await prisma.inventory.updateMany({
      where: { variantId: f.variantId, branchId: f.branchId },
      data: { quantity: 0 },
    });

    await expect(
      prisma.$transaction((tx) =>
        assertRawStockCovers(tx, [{ variantId: f.variantId, quantity: 1 }], f.branchId)
      )
    ).rejects.toBeInstanceOf(SoldOutError);
  });

  it('re-check collapses duplicate lines of the same variant', async () => {
    const f = await makeFixture(1);
    await expect(
      prisma.$transaction((tx) =>
        assertRawStockCovers(
          tx,
          [
            { variantId: f.variantId, quantity: 1 },
            { variantId: f.variantId, quantity: 1 },
          ],
          f.branchId
        )
      )
    ).rejects.toBeInstanceOf(SoldOutError);
  });

  // ── Branch isolation ──────────────────────────────────────────────────────
  it('does not let a hold at one branch consume another branch stock', async () => {
    const a = await makeFixture(1);
    const b = await makeFixture(1);

    await prisma.inventory.create({
      data: { variantId: a.variantId, branchId: b.branchId, quantity: 1 },
    });

    await prisma.$transaction((tx) =>
      reserve(tx, {
        variantId: a.variantId,
        branchId: a.branchId,
        quantity: 1,
        holdMinutes: HOLD,
      })
    );

    await expect(availableUnits(a.variantId, a.branchId)).resolves.toBe(0);
    await expect(availableUnits(a.variantId, b.branchId)).resolves.toBe(1);
  });

  it('resolves a page of variants in one call', async () => {
    const f1 = await makeFixture(2);
    const f2 = await makeFixture(0);
    const map = await availabilityFor([f1.variantId, f2.variantId], f1.branchId);
    expect(map.get(f1.variantId)?.available).toBe(2);
    // f2 belongs to another branch, so it is unavailable here — not unlimited.
    expect(map.get(f2.variantId)?.available).toBe(0);
  });
});
