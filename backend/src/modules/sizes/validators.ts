import { z } from 'zod';

export const createSizeSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(50),
    sortOrder: z.number().int().optional().nullable(),
  }),
});

export const updateSizeSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({
    name: z.string().min(1, 'Name is required').max(50).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
});

export const reorderSizesSchema = z.object({
  body: z.object({
    ids: z.array(z.number().int().positive()).min(1, 'ids is required'),
  }),
});
