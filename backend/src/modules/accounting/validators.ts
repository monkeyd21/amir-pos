import { z } from 'zod';

export const createAccountSchema = z.object({
  body: z.object({
    code: z.string().min(1, 'Account code is required'),
    name: z.string().min(1, 'Account name is required'),
    type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    parentId: z.number().int().positive().optional().nullable(),
    isSystem: z.boolean().optional(),
  }),
});

export const updateAccountSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    parentId: z.number().int().positive().optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const createJournalEntrySchema = z.object({
  body: z.object({
    branchId: z.number().int().positive(),
    date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    description: z.string().min(1, 'Description is required'),
    referenceType: z.string().optional(),
    referenceId: z.number().int().optional(),
    lines: z
      .array(
        z.object({
          accountId: z.number().int().positive(),
          debit: z.number().min(0).default(0),
          credit: z.number().min(0).default(0),
          description: z.string().optional(),
        })
      )
      .min(2, 'At least 2 journal lines are required'),
  }),
});

export const listJournalEntriesSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    branchId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const ledgerSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
    accountId: z.string().optional(),
  }),
});

export const pnlSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});

export const trialBalanceSchema = z.object({
  query: z.object({
    asOfDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});
