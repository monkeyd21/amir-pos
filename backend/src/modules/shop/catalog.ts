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

/** size name → age label, e.g. "24" → "5 years". */
async function ageLabelMap(): Promise<Map<string, string>> {
  const sizes = await prisma.size.findMany({
    where: { isActive: true },
    select: { name: true, ageLabel: true },
  });
  return new Map(sizes.filter((s) => s.ageLabel).map((s) => [s.name, s.ageLabel as string]));
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
    const band = AGE_BANDS.find((b) => b.slug === query.age);
    if (band) band.sizes.forEach((s) => sizeNames.add(s));
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

  const [rows, total, ages] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }) as Promise<ProductWithRelations[]>,
    prisma.product.count({ where }),
    ageLabelMap(),
  ]);

  const allVariantIds = rows.flatMap((p) => p.variants.map((v) => v.id));
  const stock = await availabilityFor(allVariantIds, branchId);

  const items = rows.map((p) => {
    const priced = p.variants.map((v) => ({
      id: v.id,
      size: v.size,
      ageLabel: ages.get(v.size) ?? null,
      price: chargePrice(v),
      mrp: mrpFor(v),
      available: stock.get(v.id)?.available ?? 0,
    }));

    const inStock = priced.filter((v) => v.available > 0);
    const pool = inStock.length > 0 ? inStock : priced;
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
      sizeRange: priced.map((v) => v.size),
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

  const sizeMeta = await prisma.size.findMany({
    where: { name: { in: product.variants.map((v) => v.size) } },
  });
  const metaBySize = new Map(sizeMeta.map((s) => [s.name, s]));

  const variants = product.variants
    .map((v) => {
      const meta = metaBySize.get(v.size);
      const available = stock.get(v.id)?.available ?? 0;
      return {
        id: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        // The age is the point. A parent reads "5 years", not "24".
        ageLabel: meta?.ageLabel ?? null,
        sortOrder: meta?.sortOrder ?? 0,
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

  const inStock = variants.filter((v) => v.inStock);
  const pricePool = inStock.length > 0 ? inStock : variants;

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
    variants,
    priceFrom: pricePool.length ? Math.min(...pricePool.map((v) => v.price)) : 0,
    mrpFrom: pricePool.length ? Math.min(...pricePool.map((v) => v.mrp)) : 0,
    inStock: inStock.length > 0,
    /** "Made in sizes 16 to 30" — the honest range, stock aside. */
    madeInSizes: variants.map((v) => ({ size: v.size, ageLabel: v.ageLabel })),
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
