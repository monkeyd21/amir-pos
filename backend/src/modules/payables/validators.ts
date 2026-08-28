import { z } from 'zod';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d+$/;

const PAYABLE_SOURCES = ['recurring_expense', 'adhoc_expense', 'payroll', 'commission'] as const;
const PAYABLE_STATUSES = ['pending', 'part_paid', 'paid', 'void'] as const;
const PAY_METHODS = ['cash', 'upi', 'card', 'bank', 'cheque'] as const;

const month = z.string().regex(MONTH, 'month must be YYYY-MM');
const ymd = z.string().regex(YMD, 'date must be YYYY-MM-DD');
const numericId = z.string().regex(ID, 'must be a number');

export const idParamSchema = z.object({
  params: z.object({ id: numericId }),
});

export const listPayablesSchema = z.object({
  query: z.object({
    month: month.optional(),
    status: z.enum(PAYABLE_STATUSES).optional(),
    source: z.enum(PAYABLE_SOURCES).optional(),
    categoryId: numericId.optional(),
    branchId: numericId.optional(),
    userId: numericId.optional(),
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const ensureMonthSchema = z.object({
  body: z.object({
    month,
  }),
});

export const createPayableSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    amount: z.number().positive('Amount must be greater than zero'),
    // Dropdowns send null for "Select…" — .optional() alone rejects null.
    categoryId: z.number().int().positive().optional().nullable(),
    userId: z.number().int().positive().optional().nullable(),
    periodMonth: month.optional().nullable(),
    dueDate: ymd.optional().nullable(),
    description: z.string().optional().nullable(),
    receiptUrl: z.string().optional().nullable(),
    branchId: z.number().int().positive().optional().nullable(),
  }),
});

export const updatePayableSchema = z.object({
  params: z.object({ id: numericId }),
  body: z.object({
    title: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
    categoryId: z.number().int().positive().optional().nullable(),
    periodMonth: month.optional().nullable(),
    dueDate: ymd.optional().nullable(),
    description: z.string().optional().nullable(),
    receiptUrl: z.string().optional().nullable(),
  }),
});

export const payPayableSchema = z.object({
  params: z.object({ id: numericId }),
  body: z.object({
    amount: z.number().positive('Payment amount must be greater than zero'),
    method: z.enum(PAY_METHODS),
    // Accepts a plain IST date or a full ISO instant; defaults to now.
    paidAt: z.string().min(1).optional().nullable(),
    reference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    sessionId: z.number().int().positive().optional().nullable(),
  }),
});

export const summarySchema = z.object({
  query: z.object({
    from: ymd.optional(),
    to: ymd.optional(),
    month: month.optional(),
    branchId: numericId.optional(),
  }),
});

export const outstandingSchema = z.object({
  query: z.object({
    branchId: numericId.optional(),
  }),
});

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    isRecurring: z.boolean().optional(),
    defaultAmount: z.number().nonnegative().optional().nullable(),
    dueDay: z.number().int().min(1).max(31).optional().nullable(),
    sortOrder: z.number().int().optional(),
    accountId: z.number().int().positive().optional().nullable(),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({ id: numericId }),
  body: z.object({
    name: z.string().min(1).optional(),
    isRecurring: z.boolean().optional(),
    defaultAmount: z.number().nonnegative().optional().nullable(),
    dueDay: z.number().int().min(1).max(31).optional().nullable(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    accountId: z.number().int().positive().optional().nullable(),
  }),
});
