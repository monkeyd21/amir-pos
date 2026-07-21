import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { nextBarcodes } from '../../utils/helpers';

export const lookupByBarcode = async (barcode: string) => {
  const variant = await prisma.productVariant.findUnique({
    where: { barcode },
    include: {
      product: {
        include: {
          brand: { select: { id: true, name: true, slug: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!variant) {
    throw new AppError('Product not found for this barcode', 404);
  }

  return variant;
};

export const generateBarcode = async (variantId: number) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
  });

  if (!variant) {
    throw new AppError('Variant not found', 404);
  }

  // If variant already has a barcode, return it
  if (variant.barcode) {
    return { variantId: variant.id, barcode: variant.barcode, sku: variant.sku };
  }

  const [barcode] = await nextBarcodes(1);

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: { barcode },
  });

  return { variantId: updated.id, barcode: updated.barcode, sku: updated.sku };
};

export const printBatch = async (variantIds: number[]) => {
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: {
      product: {
        include: {
          brand: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (variants.length === 0) {
    throw new AppError('No variants found for the given IDs', 404);
  }

  const barcodeData = variants.map((v) => ({
    variantId: v.id,
    sku: v.sku,
    barcode: v.barcode,
    productName: v.product.name,
    brandName: v.product.brand.name,
    size: v.size,
    color: v.color,
    lotCode: v.lotCode,
    price: v.priceOverride ?? v.product.basePrice,
    // §13.3 — MRP for the label (falls back to sale price if unset).
    mrp: v.product.mrp ?? v.priceOverride ?? v.product.basePrice,
  }));

  return barcodeData;
};
