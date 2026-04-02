import { z } from 'zod';

export const updateConfigSchema = z.object({
  body: z.object({
    pointsPerAmount: z.number().int().positive().optional(),
    amountPerPoint: z.number().int().positive().optional(),
    redemptionValue: z.number().positive().optional(),
    tierThresholds: z
      .object({
        silver: z.number().int().positive(),
        gold: z.number().int().positive(),
        platinum: z.number().int().positive(),
      })
      .optional(),
    earningMultipliers: z
      .object({
        bronze: z.number().positive(),
        silver: z.number().positive(),
        gold: z.number().positive(),
        platinum: z.number().positive(),
      })
      .optional(),
  }),
});

export const earnPointsSchema = z.object({
  body: z.object({
    customerId: z.number().int().positive(),
    saleId: z.number().int().positive().optional(),
    saleTotal: z.number().positive(),
  }),
});

export const redeemPointsSchema = z.object({
  body: z.object({
    customerId: z.number().int().positive(),
    saleId: z.number().int().positive().optional(),
    points: z.number().int().positive(),
  }),
});

export const adjustPointsSchema = z.object({
  body: z.object({
    customerId: z.number().int().positive(),
    points: z.number().int(),
    reason: z.string().min(1, 'Reason is required'),
  }),
});
