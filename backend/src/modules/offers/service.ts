import prisma from '../../config/database';
import { offerCoverage } from '@clothing-erp/shared';
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
      // Ids only. The counting rule needs which ARTICLES are touched, not the
      // rows themselves, and an offer can hold a hundred variant assignments.
      products: { select: { productId: true } },
      variants: { select: { variant: { select: { productId: true } } } },
    },
    orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
  });

  // A whole-article assignment reaches every variant of that article, so the
  // list needs each covered article's variant count to say how far the offer
  // actually goes. One grouped query for every offer on the page.
  const wholeArticleIds = [
    ...new Set(offers.flatMap((o) => (o.products ?? []).map((p) => p.productId))),
  ];
  const totals = wholeArticleIds.length
    ? await prisma.productVariant.groupBy({
        by: ['productId'],
        where: { productId: { in: wholeArticleIds } },
        _count: { _all: true },
      })
    : [];
  const variantTotals: Record<number, number> = {};
  for (const t of totals ?? []) variantTotals[t.productId] = t._count._all;

  // `_count` stays on the payload (it is the raw assignment rows, which the
  // editor below the list still reasons about); `coverage` is what the list
  // SHOWS, and it is the same rule the offer page prints. See
  // `shared/src/offer-coverage.ts` for why the two differ.
  return offers.map(({ products, variants, ...offer }) => ({
    ...offer,
    coverage: offerCoverage(
      {
        productIds: (products ?? []).map((p) => p.productId),
        variantProductIds: (variants ?? []).map((v) => v.variant.productId),
      },
      variantTotals
    ),
  }));
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
