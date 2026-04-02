import { z } from 'zod';

export const salesReportSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
    productId: z.string().optional(),
    brandId: z.string().optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional(),
    format: z.enum(['json', 'csv']).optional(),
  }),
});

export const inventoryReportSchema = z.object({
  query: z.object({
    branchId: z.string().optional(),
    format: z.enum(['json', 'csv']).optional(),
  }),
});

export const customerReportSchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    format: z.enum(['json', 'csv']).optional(),
  }),
});

export const commissionReportSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
    format: z.enum(['json', 'csv']).optional(),
  }),
});

export const pnlReportSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
    format: z.enum(['json', 'csv']).optional(),
  }),
});

export const dailySummarySchema = z.object({
  query: z.object({
    date: z.string().optional(),
    branchId: z.string().optional(),
    format: z.enum(['json', 'csv']).optional(),
  }),
});
