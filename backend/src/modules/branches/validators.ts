import { z } from 'zod';

export const createBranchSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    code: z.string().min(1, 'Code is required'),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    taxConfig: z.record(z.any()).optional(),
    receiptHeader: z.string().optional(),
    receiptFooter: z.string().optional(),
  }),
});

export const updateBranchSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    address: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    taxConfig: z.record(z.any()).optional(),
    receiptHeader: z.string().optional().nullable(),
    receiptFooter: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const getBranchSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
});
