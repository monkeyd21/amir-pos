/**
 * Storefront catalogue reads.
 *
 * Two rules run through everything here:
 *
 *  - Prices come from `pos/pricing.ts`, never computed locally. One
 *    implementation of what a garment costs, shared with the till.
 *  - Stock comes from `availability.ts`, never from `inventory.quantity`.
 *
 * Kidswear sizing shapes the shape of the responses: a size is a number that
 * means nothing on its own, so every size that leaves this module carries its
 * age label with it.
 */
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { shopConfig } from '../../config/shop';
import { chargePrice, mrpFor, isClearanceLine } from '../pos/pricing';
import { availabilityFor } from './availability';
import { AGE_BANDS } from '@clothing-erp/shared';

// `Prisma.validator` keeps full result-type inference while allowing the
// mutable arrays Prisma's orderBy expects (a plain `as const` makes them
// readonly and no longer assignable).
const variantInclude = Prisma.validator<Prisma.ProductVariantInclude>()({
  product: {
    select: {
      mrp: true,
      basePrice: true,
      cgstRate: true,
      sgstRate: true,
      priceIncludesTax: true,
    },
  },
});

const productInclude = Prisma.validator<Prisma.ProductInclude>()({
  brand: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  variants: {
    where: { isActive: true, onlineSellable: true },
    include: variantInclude,
  },
});

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export interface ShopSize {
  name: string;
  ageLabel: string | null;
  sortOrder: number;
  chestInches: number | null;
  lengthInches: number | null;
}

/** The size master, ordered — the source for size chips and the size guide. */
export async function listSizes(): Promise<ShopSize[]> {
  const rows = await prisma.size.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((s) => ({
    name: s.name,
    ageLabel: s.ageLabel,
    sortOrder: s.sortOrder,
    chestInches: s.chestInches === null ? null : Number(s.chestInches),
    lengthInches: s.lengthInches === null ? null : Number(s.lengthInches),
  }));
}

/**
 * Size names in this catalogue come from two vocabularies that were never
 * reconciled: the `sizes` master holds age forms ("4-5 Y", "6-9 M") while
 * `product_variants.size` is free text and mostly plain numbers. Spelling also
 * drifts — "6-9 M" in the master, "6-9M" on the variant.
 *
 * So every lookup is on a NORMALISED key: lowercased, spaces stripped. An exact
 * join here silently loses about a fifth of the catalogue.
 */
const sizeKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '');

/**
 * size name → age label, e.g. "24" → "5 years".
 *
 * Only the numeric sizes carry a label, and that is the point: "24" tells a
 * parent nothing, whereas "6-9 M" already IS an age and needs no help.
 */
async function ageLabelMap(): Promise<Map<string, string>> {
  const sizes = await prisma.size.findMany({
    where: { isActive: true },
    select: { name: true, ageLabel: true },
  });
  return new Map(
    sizes.filter((s) => s.ageLabel).map((s) => [sizeKey(s.name), s.ageLabel as string])
  );
}

/** size name → sortOrder, so a card's size range reads smallest-first. */
async function sizeOrderMap(): Promise<Map<string, number>> {
  const sizes = await prisma.size.findMany({ select: { name: true, sortOrder: true } });
  return new Map(sizes.map((s) => [sizeKey(s.name), s.sortOrder]));
}

/**
 * The size names that fit a given age band, resolved from the age RANGE stored
 * on each size rather than a hardcoded list — so a band matches both "22" and
 * "4-5 Y" without either vocabulary being privileged.
 */
async function sizeNamesForAgeBand(slug: string): Promise<string[]> {
  const band = AGE_BANDS.find((b) => b.slug === slug);
  if (!band) return [];

  // Derive the band's month window from the sizes it names in the shared
  // config, then find every size whose own range overlaps that window.
  const anchors = await prisma.size.findMany({
    where: { name: { in: [...band.sizes] } },
    select: { ageFromMonths: true, ageToMonths: true },
  });
  const froms = anchors.map((a) => a.ageFromMonths).filter((n): n is number => n != null);
  const tos = anchors.map((a) => a.ageToMonths).filter((n): n is number => n != null);
  if (froms.length === 0 || tos.length === 0) return [...band.sizes];

  const from = Math.min(...froms);
  const to = Math.max(...tos);

  const overlapping = await prisma.size.findMany({
    where: {
      isActive: true,
      ageFromMonths: { lte: to },
      ageToMonths: { gte: from },
    },
    select: { name: true },
  });
  return overlapping.map((s) => s.name);
}

function primaryImage(images: { url: string; alt: string | null }[]) {
  return images.length > 0 ? { url: images[0].url, alt: images[0].alt } : null;
}

export interface ListQuery {
  page?: string;
  limit?: string;
  category?: string;
  audience?: string;
  age?: string;
  size?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  q?: string;
  newIn?: string;
  sale?: string;
}

/**
 * Listing page. Returns one card per product with a price range, its primary
 * image, and which sizes are actually buyable right now.
 */
export async function listProducts(query: ListQuery, branchId = shopConfig.branchId) {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(
    60,
    Math.max(1, parseInt(query.limit || String(shopConfig.catalogue.pageSize), 10))
  );

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    onlineVisible: true,
  };

  if (query.category) where.category = { slug: query.category };
  if (query.audience) where.audience = query.audience;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { onlineDescription: { contains: query.q, mode: 'insensitive' } },
      { brand: { name: { contains: query.q, mode: 'insensitive' } } },
      { category: { name: { contains: query.q, mode: 'insensitive' } } },
    ];
  }
  if (query.newIn === 'true') {
    const since = new Date();
    since.setDate(since.getDate() - shopConfig.catalogue.newInDays);
    where.createdAt = { gte: since };
  }

  // Age and size both narrow to a set of size names — parents filter by age,
  // which is the whole reason the age band exists.
  const sizeNames = new Set<string>();
  if (query.age) {
    (await sizeNamesForAgeBand(query.age)).forEach((s) => sizeNames.add(s));
  }
  if (query.size) query.size.split(',').forEach((s) => sizeNames.add(s.trim()));
  if (sizeNames.size > 0) {
    where.variants = {
      some: { isActive: true, onlineSellable: true, size: { in: [...sizeNames] } },
    };
  }

  if (shopConfig.catalogue.hideProductsWithoutImages) {
    where.images = { some: {} };
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    query.sort === 'price-asc'
      ? { basePrice: 'asc' }
      : query.sort === 'price-desc'
      ? { basePrice: 'desc' }
      : query.sort === 'name'
      ? { name: 'asc' }
      : { createdAt: 'desc' };

  const [rows, total, ages, order] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }) as Promise<ProductWithRelations[]>,
    prisma.product.count({ where }),
    ageLabelMap(),
    sizeOrderMap(),
  ]);

  const allVariantIds = rows.flatMap((p) => p.variants.map((v) => v.id));
  const stock = await availabilityFor(allVariantIds, branchId);

  const items = rows.map((p) => {
    const priced = p.variants.map((v) => ({
      id: v.id,
      size: v.size,
      ageLabel: ages.get(sizeKey(v.size)) ?? null,
      // A size the master does not know (a typo like "18/20") sorts to the
      // END rather than the front, where it would be the first thing read.
      sortOrder: order.get(sizeKey(v.size)) ?? 9999,
      price: chargePrice(v),
      mrp: mrpFor(v),
      available: stock.get(v.id)?.available ?? 0,
    }));

    // A product can carry several variants in the SAME size — different colours
    // of one style. A size picker that lists "32" twice is broken, so sizes are
    // deduped for display, preferring one that is actually in stock.
    const bySize = new Map<string, (typeof priced)[number]>();
    for (const v of priced) {
      const seen = bySize.get(v.size);
      if (!seen || (seen.available <= 0 && v.available > 0)) bySize.set(v.size, v);
    }
    // Smallest first — a parent scanning a card should see the range read
    // naturally, not in whatever order the variants were created.
    const uniqueSizes = [...bySize.values()].sort((a, b) => a.sortOrder - b.sortOrder);

    const inStock = uniqueSizes.filter((v) => v.available > 0);
    const pool = inStock.length > 0 ? inStock : uniqueSizes;
    const prices = pool.map((v) => v.price);
    const mrps = pool.map((v) => v.mrp);

    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      category: p.category,
      audience: p.audience,
      image: primaryImage(p.images),
      priceFrom: prices.length ? Math.min(...prices) : 0,
      priceTo: prices.length ? Math.max(...prices) : 0,
      mrpFrom: mrps.length ? Math.min(...mrps) : 0,
      /** True when SOME size is buyable — never that a particular size is. */
      inStock: inStock.length > 0,
      /** Sizes a shopper can actually buy today, each carrying its age. */
      availableSizes: inStock.map((v) => ({ size: v.size, ageLabel: v.ageLabel })),
      /** Every size the style is made in, so "made in 16–30" can be shown. */
      sizeRange: uniqueSizes.map((v) => v.size),
    };
  });

  const filtered =
    query.sale === 'true' ? items.filter((i) => i.mrpFrom > i.priceFrom) : items;

  return {
    items: filtered,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/** Product detail, with per-size availability and measurements. */
export async function getProductBySlug(slug: string, branchId = shopConfig.branchId) {
  const product = (await prisma.product.findFirst({
    where: { slug, isActive: true, onlineVisible: true },
    include: productInclude,
  })) as ProductWithRelations | null;

  if (!product) throw new AppError('Product not found', 404);

  const stock = await availabilityFor(
    product.variants.map((v) => v.id),
    branchId
  );

  // Fetch the whole (small) size master and match on the normalised key rather
  // than an exact `name IN (...)`, which misses "6-9M" against "6-9 M".
  const sizeMeta = await prisma.size.findMany({ where: { isActive: true } });
  const metaBySize = new Map(sizeMeta.map((s) => [sizeKey(s.name), s]));

  const variants = product.variants
    .map((v) => {
      const meta = metaBySize.get(sizeKey(v.size));
      const available = stock.get(v.id)?.available ?? 0;
      return {
        id: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        // The age is the point. A parent reads "5 years", not "24".
        ageLabel: meta?.ageLabel ?? null,
        sortOrder: meta?.sortOrder ?? 9999,
        chestInches: meta?.chestInches === undefined || meta?.chestInches === null ? null : Number(meta.chestInches),
        lengthInches: meta?.lengthInches === undefined || meta?.lengthInches === null ? null : Number(meta.lengthInches),
        price: chargePrice(v),
        mrp: mrpFor(v),
        isClearance: isClearanceLine(v),
        available,
        inStock: available > 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Dedupe by size for the same reason as the listing: one chip per size.
  // Colour selection within a size is a follow-up; today the in-stock variant
  // wins so the chip is never falsely shown as sold out.
  const bySize = new Map<string, (typeof variants)[number]>();
  for (const v of variants) {
    const seen = bySize.get(v.size);
    if (!seen || (!seen.inStock && v.inStock)) bySize.set(v.size, v);
  }
  const uniqueVariants = [...bySize.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  const inStock = uniqueVariants.filter((v) => v.inStock);
  const pricePool = inStock.length > 0 ? inStock : uniqueVariants;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.onlineDescription || product.description,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    audience: product.audience,
    brand: product.brand,
    category: product.category,
    codBlocked: product.codBlocked,
    images: product.images.map((i) => ({
      url: i.url,
      alt: i.alt,
      width: i.width,
      height: i.height,
    })),
    variants: uniqueVariants,
    priceFrom: pricePool.length ? Math.min(...pricePool.map((v) => v.price)) : 0,
    mrpFrom: pricePool.length ? Math.min(...pricePool.map((v) => v.mrp)) : 0,
    inStock: inStock.length > 0,
    /** "Made in sizes 16 to 30" — the honest range, stock aside. */
    madeInSizes: uniqueVariants.map((v) => ({ size: v.size, ageLabel: v.ageLabel })),
  };
}

/** Navigation facets: categories with live counts, plus the age bands. */
export async function getFacets() {
  const categories = await prisma.category.findMany({
    where: { isActive: true, products: { some: { isActive: true, onlineVisible: true } } },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: { products: { where: { isActive: true, onlineVisible: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      count: c._count.products,
    })),
    ageBands: AGE_BANDS.map((b) => ({ slug: b.slug, label: b.label, sizes: [...b.sizes] })),
    sizes: await listSizes(),
  };
}

/** Related products — same category, excluding the one being viewed. */
export async function getRelated(productId: number, branchId = shopConfig.branchId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true },
  });
  if (!product) return [];

  const { items } = await listProducts({ limit: String(shopConfig.catalogue.relatedCount + 1) }, branchId);
  return items.filter((i) => i.id !== productId).slice(0, shopConfig.catalogue.relatedCount);
}
