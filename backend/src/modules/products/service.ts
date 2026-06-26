import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { slugify, generateSKU, generateEAN13, getPagination, buildPaginationMeta } from '../../utils/helpers';
import { MovementType } from '@prisma/client';

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
      variants: {
        orderBy: { createdAt: 'asc' },
        include: {
          inventory: { select: { quantity: true, branchId: true } },
        },
      },
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
  landingPrice?: number | null;
  hsnCode?: string | null;
  cgstRate?: number;
  sgstRate?: number;
  priceIncludesTax?: boolean;
  nonReturnable?: boolean;
  exchangeOnly?: boolean;
  vendorId?: number;
  lotCode?: string;
  variants?: Array<{
    size: string;
    color: string;
    priceOverride?: number;
    costOverride?: number;
    initialStock?: number;
  }>;
}, userId?: number, branchId?: number) => {
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
      landingPrice: data.landingPrice ?? null,
      hsnCode: data.hsnCode ?? null,
      cgstRate: data.cgstRate ?? 9,
      sgstRate: data.sgstRate ?? 9,
      priceIncludesTax: data.priceIncludesTax ?? true,
      nonReturnable: data.nonReturnable ?? false,
      exchangeOnly: data.exchangeOnly ?? false,
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

  // Auto-create inventory records (qty 0) for all active branches
  if (product.variants.length > 0) {
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
    if (branches.length > 0) {
      await prisma.inventory.createMany({
        data: product.variants.flatMap((v) =>
          branches.map((b) => ({
            variantId: v.id,
            branchId: b.id,
            quantity: 0,
            minStockLevel: 5,
          }))
        ),
        skipDuplicates: true,
      });
    }

    // Apply initial stock + create purchase movements if vendor/lot provided
    if (branchId && userId) {
      const variantsWithStock = (data.variants || [])
        .map((dv, i) => ({ ...dv, dbVariant: product.variants[i] }))
        .filter((v) => v.initialStock && v.initialStock > 0);

      if (variantsWithStock.length > 0) {
        for (const v of variantsWithStock) {
          await prisma.inventory.update({
            where: { variantId_branchId: { variantId: v.dbVariant.id, branchId } },
            data: { quantity: v.initialStock! },
          });
          await prisma.inventoryMovement.create({
            data: {
              variantId: v.dbVariant.id,
              branchId,
              type: 'purchase',
              quantity: v.initialStock!,
              lotCode: data.lotCode ?? null,
              notes: data.vendorId
                ? `Initial stock — product creation`
                : 'Initial stock — product creation',
              createdBy: userId,
              vendorId: data.vendorId ?? null,
            },
          });
        }
      }
    }
  }

  return product;
};

export const updateProduct = async (id: number, data: {
  name?: string;
  brandId?: number;
  categoryId?: number;
  description?: string | null;
  basePrice?: number;
  costPrice?: number;
  landingPrice?: number | null;
  hsnCode?: string | null;
  cgstRate?: number;
  sgstRate?: number;
  priceIncludesTax?: boolean;
  nonReturnable?: boolean;
  exchangeOnly?: boolean;
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

  // Auto-create inventory records (qty 0) for all active branches
  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
  if (branches.length > 0) {
    await prisma.inventory.createMany({
      data: branches.map((b) => ({
        variantId: variant.id,
        branchId: b.id,
        quantity: 0,
        minStockLevel: 5,
      })),
      skipDuplicates: true,
    });
  }

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

export const bulkCreateVariants = async (
  productId: number,
  data: {
    variants: Array<{
      size: string;
      color: string;
      sku?: string;
      priceOverride?: number;
      costOverride?: number;
      initialStock?: number;
      unitCost?: number | null;
    }>;
    branchId?: number;
    vendorId?: number;
    lotCode?: string | null;
    paymentMode?: 'cash' | 'credit';
    dueDate?: string | Date | null;
    notes?: string | null;
  },
  userId: number,
  userBranchId: number
) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { brand: true, variants: { select: { id: true, size: true, color: true } } },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  if (!data.variants || data.variants.length === 0) {
    throw new AppError('At least one variant is required', 400);
  }

  // Verify vendor if provided
  if (data.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor) throw new AppError('Vendor not found', 404);
  }

  const branchId = data.branchId ?? userBranchId;

  // Verify branch
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new AppError('Branch not found', 404);

  // Build a (size,color) → existing variant map so we can both detect
  // collisions AND increment stock on the matched variant when the
  // caller is using this endpoint as a "restock-or-create" from the
  // edit page.
  const existingByKey = new Map<string, { id: number }>();
  for (const v of product.variants) {
    existingByKey.set(`${v.size.toLowerCase()}|${v.color.toLowerCase()}`, v);
  }

  const toCreate: typeof data.variants = [];
  const toIncrement: Array<{ variantId: number; quantity: number; unitCost: number | null; size: string; color: string }> = [];
  const skipped: Array<{ size: string; color: string; reason: string }> = [];

  const seenInBatch = new Set<string>();
  for (const v of data.variants) {
    const key = `${v.size.toLowerCase()}|${v.color.toLowerCase()}`;
    if (seenInBatch.has(key)) {
      skipped.push({ size: v.size, color: v.color, reason: 'duplicate within batch' });
      continue;
    }
    seenInBatch.add(key);

    const existing = existingByKey.get(key);
    if (existing) {
      // Already on the product — top up its stock if the caller passed
      // a quantity, otherwise it's a no-op (skip with a clear reason).
      if (v.initialStock && v.initialStock > 0) {
        toIncrement.push({
          variantId: existing.id,
          quantity: v.initialStock,
          unitCost: v.unitCost ?? null,
          size: v.size,
          color: v.color,
        });
      } else {
        skipped.push({ size: v.size, color: v.color, reason: 'already exists, no stock to add' });
      }
      continue;
    }

    toCreate.push(v);
  }

  if (toCreate.length === 0 && toIncrement.length === 0) {
    return { created: [], incremented: [], skipped };
  }

  // Hoisted out of the per-variant loop — the active branch list doesn't
  // change during a single bulk-create call, so one read is enough no
  // matter how many variants the user is generating.
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const dueDateValue = data.dueDate ? new Date(data.dueDate) : null;
  // When the caller passes vendor + lot + payment metadata, we treat all
  // movements created here as "purchase" so they show up in the vendor
  // ledger. Without that metadata it's just an adjustment.
  const isPurchase = Boolean(data.vendorId && data.lotCode);
  const movementType = isPurchase ? MovementType.purchase : MovementType.adjustment;
  const movementNote = data.notes?.trim() || (isPurchase ? 'restock from edit' : 'bulk variant creation');

  const result = await prisma.$transaction(async (tx) => {
    const createdVariants: any[] = [];
    const incrementedVariants: Array<{
      variantId: number;
      size: string;
      color: string;
      addedQty: number;
    }> = [];
    const stockMovements: Array<{
      variantId: number;
      branchId: number;
      type: MovementType;
      quantity: number;
      unitCost: number | null;
      paymentMode: 'cash' | 'credit' | null;
      dueDate: Date | null;
      lotCode: string | null;
      notes: string;
      createdBy: number;
      vendorId: number | null;
    }> = [];

    // ─── Existing variants — top up their stock ─────────────────────
    for (const inc of toIncrement) {
      await tx.inventory.upsert({
        where: {
          variantId_branchId: { variantId: inc.variantId, branchId },
        },
        update: { quantity: { increment: inc.quantity } },
        create: {
          variantId: inc.variantId,
          branchId,
          quantity: inc.quantity,
          minStockLevel: 5,
        },
      });

      stockMovements.push({
        variantId: inc.variantId,
        branchId,
        type: movementType,
        quantity: inc.quantity,
        unitCost: inc.unitCost,
        paymentMode: isPurchase ? data.paymentMode ?? null : null,
        dueDate: isPurchase ? dueDateValue : null,
        lotCode: data.lotCode ?? null,
        notes: movementNote,
        createdBy: userId,
        vendorId: data.vendorId ?? null,
      });

      incrementedVariants.push({
        variantId: inc.variantId,
        size: inc.size,
        color: inc.color,
        addedQty: inc.quantity,
      });
    }

    // ─── New variants — create + inventory + movement ───────────────
    // Variant creation has to stay sequential — we need the auto-incremented
    // `id` for downstream inventory + movement rows, and Prisma 5.12 lacks
    // `createManyAndReturn`. Inventory + movement writes, however, get
    // batched per-variant so we send fewer round-trips overall.
    for (const v of toCreate) {
      const sku = v.sku && v.sku.trim()
        ? v.sku.trim()
        : generateSKU(product.brand.name, product.name, v.size, v.color);
      const barcode = generateEAN13();

      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku,
          barcode,
          size: v.size,
          color: v.color,
          priceOverride: v.priceOverride ?? null,
          costOverride: v.costOverride ?? null,
        },
      });

      if (branches.length > 0) {
        await tx.inventory.createMany({
          data: branches.map((b) => ({
            variantId: variant.id,
            branchId: b.id,
            quantity: b.id === branchId ? (v.initialStock ?? 0) : 0,
            minStockLevel: 5,
          })),
          skipDuplicates: true,
        });
      }

      if (v.initialStock && v.initialStock > 0) {
        stockMovements.push({
          variantId: variant.id,
          branchId,
          type: movementType,
          quantity: v.initialStock,
          unitCost: v.unitCost ?? null,
          paymentMode: isPurchase ? data.paymentMode ?? null : null,
          dueDate: isPurchase ? dueDateValue : null,
          lotCode: data.lotCode ?? null,
          notes: movementNote,
          createdBy: userId,
          vendorId: data.vendorId ?? null,
        });
      }

      createdVariants.push(variant);
    }

    if (stockMovements.length > 0) {
      await tx.inventoryMovement.createMany({ data: stockMovements });
    }

    return { created: createdVariants, incremented: incrementedVariants };
  });

  return { ...result, skipped };
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
