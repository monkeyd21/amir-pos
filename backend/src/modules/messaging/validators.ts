import { z } from 'zod';

export const sendBillSchema = z.object({
  body: z.object({
    saleId: z.number().int().positive(),
    customerId: z.number().int().positive(),
    type: z.enum(['whatsapp', 'sms']),
  }),
});

export const sendCustomSchema = z.object({
  body: z.object({
    customerId: z.number().int().positive(),
    type: z.enum(['whatsapp', 'sms']),
    message: z.string().min(1, 'Message is required'),
  }),
});

export const listLogsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    customerId: z.string().optional(),
    type: z.string().optional(),
    status: z.string().optional(),
  }),
});
