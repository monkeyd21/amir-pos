import { z } from 'zod';

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
