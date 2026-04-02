import { z } from 'zod';

export const createBrandSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    logoUrl: z.string().url().optional(),
  }),
});

export const updateBrandSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    logoUrl: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const getBrandSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
});

export const listBrandsSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});
