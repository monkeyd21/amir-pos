import { z } from 'zod';

export const createExpenseSchema = z.object({
  body: z.object({
    branchId: z.number().int().positive(),
    categoryId: z.number().int().positive(),
    amount: z.number().positive(),
    description: z.string().min(1, 'Description is required'),
    date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    paymentMethod: z.string().min(1),
    receiptUrl: z.string().optional().nullable(),
  }),
});

export const updateExpenseSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    categoryId: z.number().int().positive().optional(),
    amount: z.number().positive().optional(),
    description: z.string().min(1).optional(),
    date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional(),
    paymentMethod: z.string().min(1).optional(),
    receiptUrl: z.string().optional().nullable(),
  }),
});

export const getExpenseSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const listExpensesSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    branchId: z.string().optional(),
    categoryId: z.string().optional(),
    status: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    accountId: z.number().int().positive().optional().nullable(),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    accountId: z.number().int().positive().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const expenseSummarySchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});
