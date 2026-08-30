/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AVAILABILITY & RESERVATIONS — the core of the shared-stock design
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The website and the shop counter sell from ONE stock room. A cashier can
 *  scan the last of something in the same second a shopper online is paying for
 *  it. This module is the answer to that.
 *
 *  The policy, in one line:
 *
 *      An in-store scan beats an unpaid web hold.
 *      A paid web order beats an in-store scan.
 *
 *  Settled money wins; unsettled intent loses. Every rule below follows.
 *
 *  Two invariants that must never be broken:
 *
 *  1. Online availability is `inventory.quantity − SUM(active reservations)`,
 *     NEVER the raw quantity. Any shop query reading `inventory.quantity`
 *     directly is a defect.
 *
 *  2. Expiry is LAZY — every read filters on `expiresAt > now`. An expired hold
 *     stops blocking a sale the instant it lapses, so correctness never depends
 *     on the sweeper having run. The sweeper (see sweeper.ts) only tidies rows
 *     for reporting; if it never runs, the system is still correct.
 *
 *  Spec: docs/ecommerce/tech-spec.html §4
 */
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/** Thrown when stock cannot cover a request. Carries a machine-readable code. */
export class SoldOutError extends AppError {
  public readonly code = 'SOLD_OUT';
  public readonly variantId: number;
  public readonly available: number;

  constructor(variantId: number, available: number, message?: string) {
    super(
      message ??
        (available <= 0
          ? 'That size has just sold out.'
          : `Only ${available} left — please reduce the quantity.`),
      409
    );
    this.variantId = variantId;
    this.available = available;
  }
}

export interface VariantAvailability {
  variantId: number;
  /** Physical stock recorded at the branch. */
  onHand: number;
  /** Units currently held by live, unexpired reservations. */
  held: number;
  /** What the storefront may sell: `onHand − held`, floored at zero. */
  available: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Available-to-sell for a set of variants at one branch.
 *
 * This is the ONLY sanctioned way for the storefront to ask "can I sell this".
 * Bulk by design: a listing page resolves a whole page of variants in one round
 * trip, which matters because a 300-style kidswear catalogue carries ~3,900
 * variants across thirteen sizes.
 */
export async function availabilityFor(
  variantIds: number[],
  branchId: number,
  client: Tx | typeof prisma = prisma,
  now: Date = new Date()
): Promise<Map<number, VariantAvailability>> {
  const result = new Map<number, VariantAvailability>();
  if (variantIds.length === 0) return result;

  const rows = await client.$queryRaw<
    { variantId: number; onHand: number; held: number }[]
  >`
    SELECT i."variantId"                        AS "variantId",
           i."quantity"                         AS "onHand",
           COALESCE(r."held", 0)::int           AS "held"
      FROM "inventory" i
      LEFT JOIN (
            SELECT "variantId", SUM("quantity")::int AS "held"
              FROM "stock_reservations"
             WHERE "branchId" = ${branchId}
               AND "status"   = 'held'
               AND "expiresAt" > ${now}
             GROUP BY "variantId"
           ) r ON r."variantId" = i."variantId"
     WHERE i."branchId"  = ${branchId}
       AND i."variantId" IN (${Prisma.join(variantIds)})
  `;

  for (const row of rows) {
    result.set(row.variantId, {
      variantId: row.variantId,
      onHand: row.onHand,
      held: row.held,
      available: Math.max(0, row.onHand - row.held),
    });
  }

  // A variant with no inventory row at this branch is simply unavailable —
  // never treat a missing row as unlimited stock.
  for (const id of variantIds) {
    if (!result.has(id)) {
      result.set(id, { variantId: id, onHand: 0, held: 0, available: 0 });
    }
  }

  return result;
}

/** Convenience wrapper for a single variant. */
export async function availableUnits(
  variantId: number,
  branchId: number,
  client: Tx | typeof prisma = prisma
): Promise<number> {
  const map = await availabilityFor([variantId], branchId, client);
  return map.get(variantId)?.available ?? 0;
}

/**
 * Take a hold, or fail.
 *
 * MUST run inside a transaction. The inventory row is locked FIRST, which
 * serialises every concurrent contender for that variant and makes the
 * check-then-insert safe without depending on a transaction isolation level.
 *
 * `excludeReservationId` lets a cart line RAISE its own quantity: the line's
 * existing hold would otherwise count against itself and make any increase
 * impossible.
 */
export async function reserve(
  tx: Tx,
  args: {
    variantId: number;
    branchId: number;
    quantity: number;
    holdMinutes: number;
    cartId?: number | null;
    orderId?: number | null;
    excludeReservationId?: number | null;
    now?: Date;
  }
) {
  const now = args.now ?? new Date();

  // 1. Serialise all contenders for this piece of stock.
  const locked = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT "quantity"
      FROM "inventory"
     WHERE "variantId" = ${args.variantId}
       AND "branchId"  = ${args.branchId}
       FOR UPDATE
  `;
  const onHand = locked[0]?.quantity ?? 0;

  // 2. Recompute what is already held, UNDER the lock.
  const heldRows = await tx.$queryRaw<{ held: number }[]>`
    SELECT COALESCE(SUM("quantity"), 0)::int AS "held"
      FROM "stock_reservations"
     WHERE "variantId" = ${args.variantId}
       AND "branchId"  = ${args.branchId}
       AND "status"    = 'held'
       AND "expiresAt" > ${now}
       AND "id" <> ${args.excludeReservationId ?? -1}
  `;
  const held = heldRows[0]?.held ?? 0;
  const available = Math.max(0, onHand - held);

  if (available < args.quantity) {
    throw new SoldOutError(args.variantId, available);
  }

  // 3. Safe to take the hold.
  return tx.stockReservation.create({
    data: {
      variantId: args.variantId,
      branchId: args.branchId,
      quantity: args.quantity,
      status: 'held',
      expiresAt: new Date(now.getTime() + args.holdMinutes * 60_000),
      cartId: args.cartId ?? null,
      orderId: args.orderId ?? null,
    },
  });
}

/** Release one hold — a cart line removed, or a quantity being replaced. */
export async function release(tx: Tx, reservationId: number): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { id: reservationId, status: 'held' },
    data: { status: 'released' },
  });
}

/** Release every live hold belonging to a cart (cart emptied or abandoned). */
export async function releaseCart(tx: Tx, cartId: number): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { cartId, status: 'held' },
    data: { status: 'released' },
  });
}

/**
 * Push every live hold on a cart out to a new expiry — used when the shopper
 * enters checkout, and again while a payment is in flight so a slow gateway
 * cannot let the hold lapse under the shopper's feet.
 */
export async function extendCartHolds(
  tx: Tx,
  cartId: number,
  minutes: number,
  now: Date = new Date()
): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { cartId, status: 'held' },
    data: { expiresAt: new Date(now.getTime() + minutes * 60_000) },
  });
}

/** Move a cart's holds onto the order they became, so they survive cart cleanup. */
export async function attachHoldsToOrder(
  tx: Tx,
  cartId: number,
  orderId: number
): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { cartId, status: 'held' },
    data: { orderId },
  });
}

/** Mark an order's holds consumed — the stock has now actually been deducted. */
export async function consumeOrderHolds(tx: Tx, orderId: number): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { orderId, status: 'held' },
    data: { status: 'consumed' },
  });
}

/** Release an order's holds — payment failed, or the order was cancelled. */
export async function releaseOrderHolds(tx: Tx, orderId: number): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { orderId, status: 'held' },
    data: { status: 'released' },
  });
}

/**
 * §4.5 — the re-check at payment confirmation.
 *
 * Deliberately checks RAW on-hand stock, ignoring reservations entirely
 * (including the order's own). Between the shopper paying and the webhook
 * landing, a cashier may have sold the same garment; the hold does not make the
 * garment exist. Failing this check is an expected outcome with a defined path
 * — refund, do not create a Sale — not an error condition.
 */
export async function assertRawStockCovers(
  tx: Tx,
  lines: { variantId: number; quantity: number }[],
  branchId: number
): Promise<void> {
  if (lines.length === 0) return;

  // Collapse duplicate variants so two lines of the same size are checked as one.
  const wanted = new Map<number, number>();
  for (const l of lines) {
    wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0) + l.quantity);
  }

  const rows = await tx.$queryRaw<{ variantId: number; quantity: number }[]>`
    SELECT "variantId", "quantity"
      FROM "inventory"
     WHERE "branchId"  = ${branchId}
       AND "variantId" IN (${Prisma.join([...wanted.keys()])})
       FOR UPDATE
  `;
  const onHand = new Map(rows.map((r) => [r.variantId, r.quantity]));

  for (const [variantId, quantity] of wanted) {
    const have = onHand.get(variantId) ?? 0;
    if (have < quantity) {
      throw new SoldOutError(
        variantId,
        have,
        'This item sold in the shop while the payment was going through.'
      );
    }
  }
}

/**
 * Live holds on a variant at a branch — what the POS shows a cashier as a
 * WARNING when they scan something a web shopper is holding. Deliberately
 * advisory: the customer standing at the counter is real and present, and the
 * web shopper has not paid.
 */
export async function liveHoldsForVariant(
  variantId: number,
  branchId: number,
  now: Date = new Date()
): Promise<{ quantity: number; expiresAt: Date }[]> {
  const rows = await prisma.stockReservation.findMany({
    where: { variantId, branchId, status: 'held', expiresAt: { gt: now } },
    select: { quantity: true, expiresAt: true },
    orderBy: { expiresAt: 'asc' },
  });
  // Defensive: this is called from the POS scan path, which must never break
  // the till because a storefront table is unreachable or empty.
  return rows ?? [];
}

/**
 * Stock owed to an online order that has already been PAID for but not yet
 * despatched. The POS blocks a scan against this (owner PIN override) — that
 * garment belongs to someone who has handed over money for it.
 */
export async function paidUnfulfilledClaims(
  variantId: number,
  branchId: number
): Promise<{ orderNumber: string; quantity: number }[]> {
  const rows = await prisma.shopOrderItem.findMany({
    where: {
      variantId,
      order: {
        branchId,
        status: { in: ['paid', 'packed'] },
      },
    },
    select: { quantity: true, order: { select: { orderNumber: true } } },
  });
  // Defensive for the same reason as above — the counter keeps working even if
  // the shop side of the schema is missing or empty.
  return (rows ?? []).map((r) => ({
    orderNumber: r.order.orderNumber,
    quantity: r.quantity,
  }));
}

/**
 * Housekeeping: flip lapsed holds from `held` to `expired`.
 *
 * Purely cosmetic — every availability read already ignores lapsed holds. This
 * exists so the reservations table reads truthfully in reports, and so the
 * table does not grow an unbounded tail of stale `held` rows.
 */
export async function expireStaleHolds(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.stockReservation.updateMany({
    where: { status: 'held', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });
  return count;
}
