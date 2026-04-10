import { z } from 'zod';

export const listInventorySchema = z.object({
  query: z.object({
    branchId: z.string().optional(),
    variantId: z.string().optional(),
    lowStock: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const adjustStockSchema = z.object({
  body: z.object({
    variantId: z.number().int().positive(),
    branchId: z.number().int().positive(),
    quantity: z.number().int().refine((v) => v !== 0, 'Quantity cannot be zero'),
    reason: z.string().min(1, 'Reason is required'),
  }),
});

export const createTransferSchema = z.object({
  body: z.object({
    fromBranchId: z.number().int().positive(),
    toBranchId: z.number().int().positive(),
    items: z
      .array(
        z.object({
          variantId: z.number().int().positive(),
          quantity: z.number().int().positive(),
        })
      )
      .min(1, 'At least one item is required'),
  }),
});

export const transferParamsSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const printBarcodesSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          sku: z.string().min(1, 'SKU is required'),
          productName: z.string().min(1, 'Product name is required'),
          variantLabel: z.string().optional(),
          price: z.number().nonnegative(),
          copies: z.number().int().positive().max(99).optional(),
        })
      )
      .min(1, 'At least one label is required')
      .max(500, 'Too many labels in a single request'),
  }),
});

export const listMovementsSchema = z.object({
  query: z.object({
    variantId: z.string().optional(),
    branchId: z.string().optional(),
    type: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});
