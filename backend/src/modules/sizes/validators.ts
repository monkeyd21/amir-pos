import { z } from 'zod';

export const createSizeSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(50),
    sortOrder: z.number().int().optional().nullable(),
  }),
});
