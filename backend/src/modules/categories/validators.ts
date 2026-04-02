import { z } from 'zod';

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    parentId: z.number().int().positive().optional().nullable(),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    parentId: z.number().int().positive().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const getCategorySchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
});

export const listCategoriesSchema = z.object({
  query: z.object({
    tree: z.string().optional(),
    search: z.string().optional(),
  }),
});
