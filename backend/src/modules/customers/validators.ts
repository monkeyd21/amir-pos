import { z } from 'zod';

export const createCustomerSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().min(10, 'Phone must be at least 10 characters'),
    email: z.string().email().optional().nullable(),
    address: z.string().optional().nullable(),
  }),
});

export const updateCustomerSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().min(10).optional(),
    email: z.string().email().optional().nullable(),
    address: z.string().optional().nullable(),
  }),
});

export const getCustomerSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const listCustomersSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
  }),
});
