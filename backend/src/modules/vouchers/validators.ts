import { z } from 'zod';

export const createVoucherSchema = z.object({
  body: z.object({
    value: z.number().positive('Voucher value must be greater than 0'),
    expiresAt: z.string().optional().nullable(),
    customerId: z.number().int().positive().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

export const listVouchersSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(['active', 'redeemed', 'expired', 'cancelled']).optional(),
    code: z.string().optional(),
    customerId: z.string().optional(),
  }),
});

export const voucherCodeParamSchema = z.object({
  params: z.object({
    code: z.string().min(1),
  }),
});

export const voucherIdParamSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});
