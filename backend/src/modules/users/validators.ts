import { z } from 'zod';

const userRoleEnum = z.enum(['owner', 'manager', 'cashier', 'staff']);

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().optional(),
    role: userRoleEnum.optional().default('staff'),
    branchId: z.number().int().positive('Branch ID must be a positive integer'),
    commissionRate: z.number().min(0).max(100).optional(),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
  body: z.object({
    email: z.string().email('Invalid email address').optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    role: userRoleEnum.optional(),
    branchId: z.number().int().positive().optional(),
    commissionRate: z.number().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const listUsersSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    branchId: z.string().optional(),
    role: z.string().optional(),
    search: z.string().optional(),
  }),
});

export const getUserSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a number'),
  }),
});
