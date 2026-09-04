import { z } from 'zod';
import {
  customerPhoneSchema,
  storedPhoneSchema,
  customerEmailSchema,
  customerAddressSchema,
} from './contact-validators';

export const createCustomerSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().optional().nullable(),
    phone: customerPhoneSchema,
    email: customerEmailSchema,
    address: customerAddressSchema,
    // §5.3 — DOB (ISO date string) + gender ('M'/'F').
    dateOfBirth: z.string().optional().nullable(),
    gender: z.enum(['M', 'F']).optional().nullable(),
    // §bug6 — child's birth MONTH only (1-12), optional. Drives the monthly
    // marketing report; deliberately less intrusive than a full DOB.
    childBirthMonth: z.number().int().min(1).max(12).optional().nullable(),
  }),
});

export const updateCustomerSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().optional().nullable(),
    // Loose here on purpose: an edit may carry a legacy number through
    // untouched. customerService.update enforces the rule on a CHANGED number.
    phone: storedPhoneSchema.optional(),
    email: customerEmailSchema,
    address: customerAddressSchema,
    dateOfBirth: z.string().optional().nullable(),
    gender: z.enum(['M', 'F']).optional().nullable(),
    // §bug6 — child's birth MONTH only (1-12), optional. Drives the monthly
    // marketing report; deliberately less intrusive than a full DOB.
    childBirthMonth: z.number().int().min(1).max(12).optional().nullable(),
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
    query: z.string().optional(),
  }),
});
