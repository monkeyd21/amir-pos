import { z } from 'zod';

export const createVendorSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    contactPerson: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().optional(),
    gstNumber: z.string().optional(),
    paymentTerms: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const updateVendorSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    contactPerson: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    address: z.string().optional().nullable(),
    gstNumber: z.string().optional().nullable(),
    paymentTerms: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const getVendorSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
});

export const listVendorsSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
});
