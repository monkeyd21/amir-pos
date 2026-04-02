import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { slugify, generateSKU, generateEAN13, getPagination, buildPaginationMeta } from '../../utils/helpers';

interface ListProductsQuery {
  page?: string;
  limit?: string;
  brandId?: string;
  categoryId?: string;
  size?: string;
  color?: string;
  search?: string;
}

export const listProducts = async (query: ListProductsQuery) => {
  const { page, limit, skip } = getPagination(query);

  const where: any = { isActive: true };

  if (query.brandId) {
    where.brandId = parseInt(query.brandId, 10);
  }
  if (query.categoryId) {
    where.categoryId = parseInt(query.categoryId, 10);
  }
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { slug: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const variantFilter: any = {};
  if (query.size) variantFilter.size = query.size;
  if (query.color) variantFilter.color = { contains: query.color, mode: 'insensitive' };

  // If filtering by variant attributes, only include products that have matching variants
  if (query.size || query.color) {
    where.variants = { some: { ...variantFilter, isActive: true } };
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        category: { select: { id: true, name: true, slug: true } },
        variants: {
          where: { isActive: true, ...variantFilter },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.count({ where }),
  ]);

  return { products, meta: buildPaginationMeta(page, limit, total) };
};

export const getProductById = async (id: number) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      brand: { select: { id: true, name: true, slug: true } },
      category: { select: { id: true, name: true, slug: true } },
      variants: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  return product;
};

export const createProduct = async (data: {
  name: string;
  brandId: number;
  categoryId: number;
  description?: string;
  basePrice: number;
  costPrice: number;
  taxRate?: number;
  variants?: Array<{
    size: string;
    color: string;
    priceOverride?: number;
    costOverride?: number;
  }>;
}) => {
  const slug = slugify(data.name);

  const existing = await prisma.product.findUnique({ where: { slug } });
  if (existing) {
    throw new AppError('Product with this name already exists', 409);
  }

  // Verify brand and category exist
  const [brand, category] = await Promise.all([
    prisma.brand.findUnique({ where: { id: data.brandId } }),
    prisma.category.findUnique({ where: { id: data.categoryId } }),
  ]);

  if (!brand) throw new AppError('Brand not found', 404);
  if (!category) throw new AppError('Category not found', 404);

  const variantData = (data.variants || []).map((v) => ({
    sku: generateSKU(brand.name, data.name, v.size, v.color),
    barcode: generateEAN13(),
    size: v.size,
    color: v.color,
    priceOverride: v.priceOverride ?? null,
    costOverride: v.costOverride ?? null,
  }));

  const product = await prisma.product.create({
    data: {
      name: data.name,
      slug,
      brandId: data.brandId,
      categoryId: data.categoryId,
      description: data.description,
      basePrice: data.basePrice,
      costPrice: data.costPrice,
      taxRate: data.taxRate ?? 18,
      variants: {
        create: variantData,
      },
    },
    include: {
      brand: { select: { id: true, name: true, slug: true } },
      category: { select: { id: true, name: true, slug: true } },
      variants: true,
    },
  });

  return product;
};

export const updateProduct = async (id: number, data: {
  name?: string;
  brandId?: number;
  categoryId?: number;
  description?: string | null;
  basePrice?: number;
  costPrice?: number;
  taxRate?: number;
  isActive?: boolean;
}) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const updateData: any = { ...data };

  if (data.name) {
    const slug = slugify(data.name);
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing && existing.id !== id) {
      throw new AppError('Product with this name already exists', 409);
    }
    updateData.slug = slug;
  }

  if (data.brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: data.brandId } });
    if (!brand) throw new AppError('Brand not found', 404);
  }

  if (data.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new AppError('Category not found', 404);
  }

  const updated = await prisma.product.update({
    where: { id },
    data: updateData,
    include: {
      brand: { select: { id: true, name: true, slug: true } },
      category: { select: { id: true, name: true, slug: true } },
      variants: { where: { isActive: true } },
    },
  });

  return updated;
};

export const deleteProduct = async (id: number) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });

  return { message: 'Product deactivated successfully' };
};

export const addVariant = async (productId: number, data: {
  size: string;
  color: string;
  priceOverride?: number;
  costOverride?: number;
}) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { brand: true },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const sku = generateSKU(product.brand.name, product.name, data.size, data.color);
  const barcode = generateEAN13();

  const variant = await prisma.productVariant.create({
    data: {
      productId,
      sku,
      barcode,
      size: data.size,
      color: data.color,
      priceOverride: data.priceOverride ?? null,
      costOverride: data.costOverride ?? null,
    },
  });

  return variant;
};

export const updateVariant = async (productId: number, variantId: number, data: {
  size?: string;
  color?: string;
  priceOverride?: number | null;
  costOverride?: number | null;
  isActive?: boolean;
}) => {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
  });

  if (!variant) {
    throw new AppError('Variant not found', 404);
  }

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data,
  });

  return updated;
};

export const deleteVariant = async (productId: number, variantId: number) => {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
  });

  if (!variant) {
    throw new AppError('Variant not found', 404);
  }

  await prisma.productVariant.update({
    where: { id: variantId },
    data: { isActive: false },
  });

  return { message: 'Variant deactivated successfully' };
};
