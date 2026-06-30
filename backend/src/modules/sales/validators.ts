import { z } from 'zod';

export const returnableByBarcodeSchema = z.object({
  params: z.object({
    barcode: z.string().min(1),
  }),
});

export const listSalesSchema = z.object({
  query: z.object({
    branchId: z.string().optional(),
    status: z.string().optional(),
    customerId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const saleIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const saleReturnParamSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
});

export const processReturnSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    items: z
      .array(
        z.object({
          saleItemId: z.number().int().positive(),
          quantity: z.number().int().positive(),
          condition: z.enum(['resellable', 'damaged']),
        })
      )
      .min(1, 'At least one item is required'),
    reason: z.string().min(1, 'Reason is required'),
    // Manager/owner only — forces the whole refund to one method instead of
    // mirroring the original payment split. Validated server-side by role.
    refundMode: z.enum(['proportional', 'cash', 'card', 'upi']).optional(),
  }),
});

// §1.4 — same-day void requires a supervisor PIN + optional reason.
export const voidSaleSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    pin: z.string().min(1, 'Supervisor PIN is required'),
    reason: z.string().optional(),
  }),
});

// Edit a completed bill. Send the DESIRED final item set: existing lines carry
// their saleItemId, new lines carry a barcode. Lines omitted are removed.
export const editSaleSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    items: z
      .array(
        z.object({
          saleItemId: z.number().int().positive().optional(),
          barcode: z.string().min(1).optional(),
          quantity: z.number().int().positive(),
          agentId: z.number().int().positive().optional().nullable(),
        })
      )
      .min(1, 'A bill must keep at least one item'),
    // New manual discount (₹) for the whole bill; offers + loyalty recompute.
    discountAmount: z.number().min(0).optional(),
    reason: z.string().min(1, 'A reason is required'),
    // Simple settlement for a price rise: name the method and the server collects
    // the EXACT computed difference (no client-side total math needed).
    settlementMethod: z.enum(['cash', 'card', 'upi']).optional(),
    settlementIdentifier: z.string().optional(),
    // Advanced settlement: explicit tenders/vouchers that must cover the rise.
    payments: z
      .array(
        z.object({
          method: z.enum(['cash', 'card', 'upi']),
          amount: z.number().positive(),
          referenceNumber: z.string().optional(),
          identifier: z.string().optional(),
        })
      )
      .optional(),
    vouchers: z
      .array(z.object({ code: z.string().min(1), amount: z.number().positive() }))
      .optional(),
  }),
});

export const processExchangeSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    returnItems: z
      .array(
        z.object({
          saleItemId: z.number().int().positive(),
          quantity: z.number().int().positive(),
          condition: z.enum(['resellable', 'damaged']),
        })
      )
      .min(1, 'At least one return item is required'),
    newItems: z
      .array(
        z.object({
          barcode: z.string().min(1),
          quantity: z.number().int().positive(),
        })
      )
      .min(1, 'At least one new item is required'),
    reason: z.string().optional(),
  }),
});
