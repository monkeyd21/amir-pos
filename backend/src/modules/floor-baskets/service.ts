import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { chargePrice } from '../pos/pricing';
import { tagMrp } from '../pos/tag-mrp';

/**
 * Dashboard spec §7.2: Salesfloor Scan.
 *
 * The salesperson who helps a customer scans the pieces on their phone into
 * a basket. At the till the cashier pulls the basket by its short code, and
 * every line it brings in is credited to that salesperson
 * (`SaleItem.agentId`, `attribution = 'salesfloor'`). Staff Performance then
 * ranks the people on the floor, not the one person at the till.
 */

const include = {
  salesperson: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: { scannedAt: 'asc' },
    include: {
      variant: {
        select: {
          id: true,
          barcode: true,
          sku: true,
          size: true,
          color: true,
          priceOverride: true,
          mrpOverride: true,
          clearanceFlag: true,
          clearancePrice: true,
          product: { select: { name: true, mrp: true, basePrice: true, cgstRate: true, sgstRate: true, priceIncludesTax: true } },
        },
      },
    },
  },
} satisfies Prisma.FloorBasketInclude;

type Basket = Prisma.FloorBasketGetPayload<{ include: typeof include }>;

export function shapeBasket(b: Basket) {
  const lines = b.items.map((i) => ({
    id: i.id,
    variantId: i.variantId,
    barcode: i.variant.barcode,
    sku: i.variant.sku,
    name: i.variant.product.name,
    size: i.variant.size,
    color: i.variant.color,
    quantity: i.quantity,
    price: chargePrice(i.variant as any),
    mrp: tagMrp(i.variant as any),
  }));
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    salesperson: { id: b.salesperson.id, name: `${b.salesperson.firstName} ${b.salesperson.lastName ?? ''}`.trim() },
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    lines,
    pieces: lines.reduce((t, l) => t + l.quantity, 0),
    value: Math.round(lines.reduce((t, l) => t + l.price * l.quantity, 0) * 100) / 100,
  };
}

export class FloorBasketService {
  /** A new basket with a 3-digit code no other open basket in the branch is using. */
  async open(userId: number, branchId: number) {
    const taken = new Set(
      (await prisma.floorBasket.findMany({ where: { branchId, status: 'open' }, select: { code: true } })).map((b) => b.code)
    );
    if (taken.size >= 900) throw new AppError('Too many open baskets. Bill or abandon some first.', 409);
    let code = '';
    do {
      code = String(100 + Math.floor(Math.random() * 900));
    } while (taken.has(code));
    const b = await prisma.floorBasket.create({ data: { branchId, salespersonId: userId, code }, include });
    return shapeBasket(b);
  }

  async listOpen(branchId: number, salespersonId?: number) {
    const rows = await prisma.floorBasket.findMany({
      where: { branchId, status: 'open', ...(salespersonId ? { salespersonId } : {}) },
      orderBy: { updatedAt: 'desc' },
      include,
    });
    return rows.map(shapeBasket);
  }

  async byCode(code: string, branchId: number) {
    const b = await prisma.floorBasket.findFirst({ where: { branchId, code, status: 'open' }, include });
    if (!b) throw new AppError(`No open basket ${code}`, 404);
    return shapeBasket(b);
  }

  private async own(id: number, userId: number, role: string, branchId: number) {
    const b = await prisma.floorBasket.findFirst({ where: { id, branchId } });
    if (!b) throw new AppError('Basket not found', 404);
    if (b.status !== 'open') throw new AppError(`Basket ${b.code} is already ${b.status.replace('_', ' ')}`, 409);
    // The salesperson's own basket; a senior may tidy anyone's.
    if (b.salespersonId !== userId && role !== 'owner' && role !== 'manager') {
      throw new AppError('This is someone else’s basket', 403);
    }
    return b;
  }

  async scan(id: number, barcode: string, userId: number, role: string, branchId: number) {
    await this.own(id, userId, role, branchId);
    const code = barcode.trim();
    const variant = await prisma.productVariant.findFirst({
      where: { isActive: true, OR: [{ barcode: { equals: code, mode: 'insensitive' } }, { sku: { equals: code, mode: 'insensitive' } }] },
      select: { id: true },
    });
    if (!variant) throw new AppError(`Not found: ${code}`, 404);
    const existing = await prisma.floorBasketItem.findFirst({ where: { basketId: id, variantId: variant.id } });
    if (existing) {
      await prisma.floorBasketItem.update({ where: { id: existing.id }, data: { quantity: { increment: 1 } } });
    } else {
      await prisma.floorBasketItem.create({ data: { basketId: id, variantId: variant.id } });
    }
    await prisma.floorBasket.update({ where: { id }, data: { updatedAt: new Date() } });
    return shapeBasket(await prisma.floorBasket.findUniqueOrThrow({ where: { id }, include }));
  }

  async removeLine(id: number, itemId: number, userId: number, role: string, branchId: number) {
    await this.own(id, userId, role, branchId);
    const item = await prisma.floorBasketItem.findFirst({ where: { id: itemId, basketId: id } });
    if (!item) throw new AppError('Line not found', 404);
    if (item.quantity > 1) {
      await prisma.floorBasketItem.update({ where: { id: itemId }, data: { quantity: { decrement: 1 } } });
    } else {
      await prisma.floorBasketItem.delete({ where: { id: itemId } });
    }
    return shapeBasket(await prisma.floorBasket.findUniqueOrThrow({ where: { id }, include }));
  }

  async abandon(id: number, userId: number, role: string, branchId: number) {
    await this.own(id, userId, role, branchId);
    await prisma.floorBasket.update({ where: { id }, data: { status: 'abandoned' } });
  }
}

/**
 * Called inside the checkout transaction: the baskets the cashier pulled are
 * now billed. Only open baskets of this branch are touched, so a stale or
 * forged id changes nothing.
 */
export async function markBasketsBilled(
  tx: Prisma.TransactionClient,
  ids: number[] | undefined,
  saleId: number,
  branchId: number
) {
  if (!ids?.length) return;
  await tx.floorBasket.updateMany({
    where: { id: { in: ids }, branchId, status: 'open' },
    data: { status: 'billed', saleId },
  });
}

export const floorBasketService = new FloorBasketService();
