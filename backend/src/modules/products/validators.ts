import { z } from 'zod';

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    brandId: z.number().int().positive('Brand ID is required'),
    categoryId: z.number().int().positive('Category ID is required'),
    description: z.string().optional(),
    basePrice: z.number().positive('Base price must be positive'),
    costPrice: z.number().positive('Cost price must be positive'),
    taxRate: z.number().min(0).max(100).optional(),
    variants: z.array(z.object({
      size: z.string().min(1, 'Size is required'),
      color: z.string().min(1, 'Color is required'),
      priceOverride: z.number().positive().optional(),
      costOverride: z.number().positive().optional(),
    })).optional(),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    brandId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    description: z.string().optional().nullable(),
    basePrice: z.number().positive().optional(),
    costPrice: z.number().positive().optional(),
    taxRate: z.number().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const getProductSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
});

export const listProductsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    brandId: z.string().optional(),
    categoryId: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    search: z.string().optional(),
  }),
});

export const createVariantSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    size: z.string().min(1, 'Size is required'),
    color: z.string().min(1, 'Color is required'),
    priceOverride: z.number().positive().optional(),
    costOverride: z.number().positive().optional(),
  }),
});

export const updateVariantSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
    variantId: z.string().regex(/^\d+$/, 'Variant ID must be a number'),
  }),
  body: z.object({
    size: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    priceOverride: z.number().positive().optional().nullable(),
    costOverride: z.number().positive().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const deleteVariantSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
    variantId: z.string().regex(/^\d+$/, 'Variant ID must be a number'),
  }),
});
