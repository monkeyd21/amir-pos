/**
 * The shopper's cart — and, because adding to it takes a hold on real stock,
 * the most safety-critical write path on the storefront.
 *
 * Every mutation runs inside a transaction that goes through
 * `availability.reserve`, which locks the inventory row first. Nothing here
 * ever reads `inventory.quantity` directly.
 */
import crypto from 'crypto';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { shopConfig } from '../../config/shop';
import { chargePrice, mrpFor, isClearanceLine } from '../pos/pricing';
import { reserve, release, releaseCart, extendCartHolds, availabilityFor } from './availability';

const HOLD = shopConfig.reservation.cartHoldMinutes;

/** Opaque cart token stored in an httpOnly cookie. */
export const newCartToken = (): string => crypto.randomBytes(24).toString('hex');

function cartExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + shopConfig.reservation.cartLifetimeDays);
  return d;
}

export async function getOrCreateCart(token: string | undefined, customerId?: number | null) {
  if (token) {
    const existing = await prisma.shopCart.findUnique({ where: { token } });
    if (existing) {
      // Claim an anonymous cart for a shopper who has just signed in.
      if (customerId && existing.customerId !== customerId) {
        return prisma.shopCart.update({
          where: { id: existing.id },
          data: { customerId, expiresAt: cartExpiry() },
        });
      }
      return existing;
    }
  }

  return prisma.shopCart.create({
    data: {
      token: token || newCartToken(),
      customerId: customerId ?? null,
      branchId: shopConfig.branchId,
      expiresAt: cartExpiry(),
    },
  });
}

/**
 * The cart as the storefront renders it: priced lines, live stock, and when
 * each hold lapses so the page can show a countdown.
 */
export async function getCartView(cartId: number) {
  const cart = await prisma.shopCart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          reservation: true,
          variant: {
            include: {
              product: {
                include: { images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 } },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!cart) throw new AppError('Cart not found', 404);

  const stock = await availabilityFor(
    cart.items.map((i) => i.variantId),
    cart.branchId
  );

  // Normalised lookup — see the note on `sizeKey` in catalog.ts. The master
  // spells it "6-9 M"; variants are typed "6-9M".
  const sizeMeta = await prisma.size.findMany({
    where: { isActive: true },
    select: { name: true, ageLabel: true },
  });
  const ages = new Map(
    sizeMeta.map((s) => [s.name.toLowerCase().replace(/\s+/g, ''), s.ageLabel])
  );

  const now = new Date();
  const lines = cart.items.map((item) => {
    const price = chargePrice(item.variant);
    const held =
      item.reservation &&
      item.reservation.status === 'held' &&
      item.reservation.expiresAt > now;

    return {
      id: item.id,
      variantId: item.variantId,
      productId: item.variant.productId,
      productName: item.variant.product.name,
      productSlug: item.variant.product.slug,
      image: item.variant.product.images[0]?.url ?? null,
      size: item.variant.size,
      ageLabel: ages.get(item.variant.size.toLowerCase().replace(/\s+/g, '')) ?? null,
      color: item.variant.color,
      quantity: item.quantity,
      unitPrice: price,
      mrp: mrpFor(item.variant),
      isClearance: isClearanceLine(item.variant),
      lineTotal: Math.round(price * item.quantity * 100) / 100,
      // Availability EXCLUDING this line's own hold, so the shopper sees how
      // many more they could add rather than zero.
      availableToAdd: stock.get(item.variantId)?.available ?? 0,
      /** Null once the hold has lapsed — the storefront then re-checks stock. */
      holdExpiresAt: held ? item.reservation!.expiresAt : null,
    };
  });

  const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  const mrpTotal = Math.round(
    lines.reduce((s, l) => s + l.mrp * l.quantity, 0) * 100
  ) / 100;

  // The soonest hold to lapse drives the single countdown shown in the UI.
  const expiries = lines.map((l) => l.holdExpiresAt).filter(Boolean) as Date[];

  return {
    id: cart.id,
    token: cart.token,
    customerId: cart.customerId,
    lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal,
    mrpTotal,
    savings: Math.round((mrpTotal - subtotal) * 100) / 100,
    holdExpiresAt: expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : null,
  };
}

/**
 * Add to cart — the moment stock is committed.
 *
 * Adding a variant already in the cart raises that line rather than creating a
 * second one, and re-reserves at the new total with the line's own existing
 * hold excluded from the availability sum.
 */
export async function addItem(cartId: number, variantId: number, quantity: number) {
  if (quantity < 1) throw new AppError('Quantity must be at least 1', 400);

  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, isActive: true, onlineSellable: true },
    include: { product: { select: { onlineVisible: true, isActive: true } } },
  });
  if (!variant || !variant.product.onlineVisible || !variant.product.isActive) {
    throw new AppError('That item is not available online', 404);
  }

  const cart = await prisma.shopCart.findUnique({ where: { id: cartId } });
  if (!cart) throw new AppError('Cart not found', 404);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.shopCartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    const wanted = (existing?.quantity ?? 0) + quantity;

    const hold = await reserve(tx, {
      variantId,
      branchId: cart.branchId,
      quantity: wanted,
      holdMinutes: HOLD,
      cartId,
      excludeReservationId: existing?.reservationId ?? null,
    });

    if (existing) {
      if (existing.reservationId) await release(tx, existing.reservationId);
      await tx.shopCartItem.update({
        where: { id: existing.id },
        data: { quantity: wanted, reservationId: hold.id },
      });
    } else {
      await tx.shopCartItem.create({
        data: { cartId, variantId, quantity: wanted, reservationId: hold.id },
      });
    }
  });

  return getCartView(cartId);
}

/** Set a line's quantity outright. Zero removes the line. */
export async function updateItem(cartId: number, itemId: number, quantity: number) {
  if (quantity < 0) throw new AppError('Quantity cannot be negative', 400);
  if (quantity === 0) return removeItem(cartId, itemId);

  const cart = await prisma.shopCart.findUnique({ where: { id: cartId } });
  if (!cart) throw new AppError('Cart not found', 404);

  await prisma.$transaction(async (tx) => {
    const item = await tx.shopCartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) throw new AppError('Item not in cart', 404);

    const hold = await reserve(tx, {
      variantId: item.variantId,
      branchId: cart.branchId,
      quantity,
      holdMinutes: HOLD,
      cartId,
      excludeReservationId: item.reservationId,
    });

    if (item.reservationId) await release(tx, item.reservationId);
    await tx.shopCartItem.update({
      where: { id: item.id },
      data: { quantity, reservationId: hold.id },
    });
  });

  return getCartView(cartId);
}

/** Remove a line and hand its stock straight back to the shelf. */
export async function removeItem(cartId: number, itemId: number) {
  await prisma.$transaction(async (tx) => {
    const item = await tx.shopCartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) throw new AppError('Item not in cart', 404);
    if (item.reservationId) await release(tx, item.reservationId);
    await tx.shopCartItem.delete({ where: { id: item.id } });
  });

  return getCartView(cartId);
}

/** Empty the cart, releasing every hold. */
export async function clearCart(cartId: number) {
  await prisma.$transaction(async (tx) => {
    await releaseCart(tx, cartId);
    await tx.shopCartItem.deleteMany({ where: { cartId } });
  });
  return getCartView(cartId);
}

/**
 * Push the holds out — called when the shopper enters checkout, and again while
 * a payment is in flight so a slow gateway cannot let the hold lapse under
 * their feet.
 */
export async function extendHolds(cartId: number, minutes = shopConfig.reservation.checkoutHoldMinutes) {
  await prisma.$transaction((tx) => extendCartHolds(tx, cartId, minutes));
  return getCartView(cartId);
}

/**
 * Re-check every line against live stock. Used when a cart page loads after
 * the holds lapsed, so the shopper is told what changed before checkout rather
 * than at payment.
 */
export async function revalidate(cartId: number) {
  const view = await getCartView(cartId);
  const problems = view.lines
    .filter((l) => l.holdExpiresAt === null && l.availableToAdd < l.quantity)
    .map((l) => ({
      itemId: l.id,
      productName: l.productName,
      size: l.size,
      ageLabel: l.ageLabel,
      wanted: l.quantity,
      available: l.availableToAdd,
    }));
  return { cart: view, problems };
}
