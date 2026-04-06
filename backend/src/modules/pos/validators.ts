import { z } from 'zod';

export const openSessionSchema = z.object({
  body: z.object({
    openingAmount: z.number().min(0, 'Opening amount must be non-negative'),
    notes: z.string().optional(),
  }),
});

export const closeSessionSchema = z.object({
  body: z.object({
    closingAmount: z.number().min(0, 'Closing amount must be non-negative'),
    notes: z.string().optional(),
  }),
});

export const checkoutSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          barcode: z.string().min(1),
          quantity: z.number().int().positive(),
        })
      )
      .min(1, 'At least one item is required'),
    customerId: z.number().int().positive().optional(),
    payments: z
      .array(
        z.object({
          method: z.enum(['cash', 'card', 'upi']),
          amount: z.number().positive(),
          referenceNumber: z.string().optional(),
        })
      )
      .min(1, 'At least one payment is required'),
    discountAmount: z.number().min(0).optional(),
    loyaltyPointsRedeem: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  }),
});

export const holdCartSchema = z.object({
  body: z.object({
    cartData: z.any(),
    customerId: z.number().int().positive().optional(),
    notes: z.string().optional(),
  }),
});

export const heldIdParamSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const createUpiPaymentSchema = z.object({
  body: z.object({
    items: z.array(z.object({
      barcode: z.string().min(1),
      quantity: z.number().int().positive(),
    })).min(1),
    customerId: z.number().int().positive().optional(),
    discountAmount: z.number().min(0).optional(),
    notes: z.string().optional(),
  }),
});

export const checkUpiPaymentSchema = z.object({
  params: z.object({
    intentId: z.string().min(1),
  }),
});
