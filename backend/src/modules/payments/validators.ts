import { z } from 'zod';

export const recordPaymentSchema = z.object({
  body: z.object({
    saleId: z.number().int().positive(),
    method: z.enum(['cash', 'card', 'upi']),
    amount: z.number().positive(),
    referenceNumber: z.string().optional(),
  }),
});

export const refundPaymentSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const paymentSummarySchema = z.object({
  query: z.object({
    branchId: z.string().optional(),
    date: z.string().optional(),
  }),
});
