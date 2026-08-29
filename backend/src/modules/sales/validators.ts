import { z } from 'zod';

export const returnableByBarcodeSchema = z.object({
  params: z.object({
    barcode: z.string().min(1),
  }),
});

// §1.2a — record a failed-inspection rejection (no transaction results).
export const rejectInspectionSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    saleItemIds: z.array(z.number().int().positive()).optional(),
    reason: z.string().min(1, 'A rejection reason is required'),
    customerMobile: z.string().optional(),
  }),
});

export const listSalesSchema = z.object({
  query: z.object({
    branchId: z.string().optional(),
    status: z.string().optional(),
    customerId: z.string().optional(),
    paymentMethod: z.string().optional(),
    search: z.string().optional(),
    businessDate: z.string().optional(),
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
    // Refund settlement (Bug#1 / §2.2b) — freely chosen, not tied to the
    // original payment. Either a single method, or an explicit cash/card/UPI
    // split that must sum to the refund total (validated in the service).
    refundMode: z.enum(['proportional', 'cash', 'card', 'upi']).optional(),
    refundSplit: z
      .array(
        z.object({
          method: z.enum(['cash', 'card', 'upi']),
          amount: z.number().positive(),
        })
      )
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

/**
 * bug5 — limited bill editing. Only the customer's identity is editable on a
 * closed bill; nothing that affects money is accepted here by design, so the
 * schema has no line-item, price or total fields to accidentally honour.
 */
export const updateBillCustomerSchema = z.object({
  params: z.object({
    saleId: z.string().regex(/^\d+$/, 'saleId must be numeric'),
  }),
  body: z.object({
    firstName: z.string().trim().min(1, 'Customer name is required'),
    // Dropdowns and cleared inputs send null — .optional() alone rejects it.
    lastName: z.string().trim().optional().nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{6,20}$/, 'Enter a valid phone number'),
  }),
});
