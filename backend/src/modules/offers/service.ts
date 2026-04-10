import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { Prisma } from '@prisma/client';

export interface OfferBody {
  name: string;
  description?: string | null;
  type:
    | 'percentage'
    | 'flat'
    | 'buy_x_get_y_free'
    | 'buy_x_get_y_percent'
    | 'bundle';
  percentValue?: number | null;
  flatValue?: number | null;
  buyQty?: number | null;
  getQty?: number | null;
  priority?: number;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

function normalize(body: OfferBody) {
  return {
    name: body.name,
    description: body.description ?? null,
    type: body.type,
    percentValue: body.percentValue ?? null,
    flatValue: body.flatValue ?? null,
    buyQty: body.buyQty ?? null,
    getQty: body.getQty ?? null,
    priority: body.priority ?? 0,
    isActive: body.isActive ?? true,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
  };
}

export async function listOffers(query: {
  isActive?: string;
  search?: string;
  type?: string;
}) {
  const where: Prisma.OfferWhereInput = {};
  if (query.isActive === 'true') where.isActive = true;
  if (query.isActive === 'false') where.isActive = false;
  if (query.type) where.type = query.type as any;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const offers = await prisma.offer.findMany({
    where,
    include: {
      _count: { select: { products: true, variants: true } },
    },
    orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
  });
  return offers;
}

export async function getOffer(id: number) {
  const offer = await prisma.offer.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              brand: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
              variants: { select: { id: true, sku: true, size: true, color: true } },
            },
          },
        },
      },
      variants: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              size: true,
              color: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  brand: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!offer) throw new AppError('Offer not found', 404);
  return offer;
}

export async function createOffer(body: OfferBody) {
  const data = normalize(body);
  return prisma.offer.create({ data });
}

export async function updateOffer(id: number, body: OfferBody) {
  const existing = await prisma.offer.findUnique({ where: { id } });
  if (!existing) throw new AppError('Offer not found', 404);
  const data = normalize(body);
  return prisma.offer.update({ where: { id }, data });
}

export async function deleteOffer(id: number) {
  const existing = await prisma.offer.findUnique({
    where: { id },
    include: { _count: { select: { saleItems: true } } },
  });
  if (!existing) throw new AppError('Offer not found', 404);

  if (existing._count.saleItems > 0) {
    // Don't delete offers referenced by past sales; deactivate instead so
    // historical reports can still resolve the relation.
    return prisma.offer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // No sales reference this offer — safe to delete. Cascade removes assignments.
  return prisma.offer.delete({ where: { id } });
}

/**
 * Atomically replace all product + variant assignments for an offer.
 * Uses a transaction: delete-all-then-insert-new.
 */
export async function setAssignments(
  id: number,
  productIds: number[],
  variantIds: number[]
) {
  const existing = await prisma.offer.findUnique({ where: { id } });
  if (!existing) throw new AppError('Offer not found', 404);

  // Dedupe
  const uniqProducts = [...new Set(productIds)];
  const uniqVariants = [...new Set(variantIds)];

  return prisma.$transaction(async (tx) => {
    await tx.offerProduct.deleteMany({ where: { offerId: id } });
    await tx.offerVariant.deleteMany({ where: { offerId: id } });

    if (uniqProducts.length > 0) {
      await tx.offerProduct.createMany({
        data: uniqProducts.map((productId) => ({ offerId: id, productId })),
        skipDuplicates: true,
      });
    }
    if (uniqVariants.length > 0) {
      await tx.offerVariant.createMany({
        data: uniqVariants.map((variantId) => ({ offerId: id, variantId })),
        skipDuplicates: true,
      });
    }

    return {
      offerId: id,
      productCount: uniqProducts.length,
      variantCount: uniqVariants.length,
    };
  });
}
