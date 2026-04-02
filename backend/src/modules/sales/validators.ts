import { z } from 'zod';

export const listSalesSchema = z.object({
  query: z.object({
    branchId: z.string().optional(),
    status: z.string().optional(),
    customerId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const saleIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const saleReturnParamSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
});

export const processReturnSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    items: z
      .array(
        z.object({
          saleItemId: z.number().int().positive(),
          quantity: z.number().int().positive(),
          condition: z.enum(['resellable', 'damaged']),
        })
      )
      .min(1, 'At least one item is required'),
    reason: z.string().min(1, 'Reason is required'),
  }),
});

export const processExchangeSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    returnItems: z
      .array(
        z.object({
          saleItemId: z.number().int().positive(),
          quantity: z.number().int().positive(),
          condition: z.enum(['resellable', 'damaged']),
        })
      )
      .min(1, 'At least one return item is required'),
    newItems: z
      .array(
        z.object({
          barcode: z.string().min(1),
          quantity: z.number().int().positive(),
        })
      )
      .min(1, 'At least one new item is required'),
    reason: z.string().optional(),
  }),
});
