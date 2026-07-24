import { z } from 'zod';

const roleEnum = z.enum(['owner', 'manager', 'cashier', 'staff']);

// Blank strings from the form mean "not provided" for optional fields.
const emptyToNull = (v: unknown) => (v === '' || v == null ? null : v);

export const createEmployeeSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required').max(100),
    // Last name and email are NOT mandatory — many employees are just
    // salespeople tracked for commission who never log in.
    lastName: z.preprocess(emptyToNull, z.string().max(100).nullable().optional()),
    email: z.preprocess(emptyToNull, z.string().email('Invalid email').nullable().optional()),
    phone: z.string().max(20).optional().nullable(),
    role: roleEnum.default('staff'),
    branchId: z.number().int().positive().optional().nullable(),
    commissionRate: z.number().min(0).max(100).optional().nullable(),
  }),
});

export const updateEmployeeSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.preprocess(emptyToNull, z.string().max(100).nullable().optional()),
    email: z.preprocess(emptyToNull, z.string().email('Invalid email').nullable().optional()),
    phone: z.string().max(20).optional().nullable(),
    role: roleEnum.optional(),
    branchId: z.number().int().positive().optional().nullable(),
    commissionRate: z.number().min(0).max(100).optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const clockInSchema = z.object({
  body: z.object({
    branchId: z.number().int().positive().optional(),
  }),
});

export const clockOutSchema = z.object({
  body: z.object({}).optional(),
});

export const listAttendanceSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    userId: z.string().optional(),
    branchId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const attendanceSummarySchema = z.object({
  query: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM'),
    branchId: z.string().optional(),
  }),
});

export const listCommissionsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    userId: z.string().optional(),
    status: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const calculateCommissionsSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});

export const payCommissionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const commissionSummarySchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});
