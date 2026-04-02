import { z } from 'zod';

export const lookupBarcodeSchema = z.object({
  params: z.object({
    barcode: z.string().min(1, 'Barcode is required'),
  }),
});

export const generateBarcodeSchema = z.object({
  body: z.object({
    variantId: z.number().int().positive('Variant ID is required'),
  }),
});

export const printBatchSchema = z.object({
  body: z.object({
    variantIds: z.array(z.number().int().positive()).min(1, 'At least one variant ID is required'),
  }),
});
