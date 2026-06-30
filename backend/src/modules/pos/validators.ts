import { z } from 'zod';

export const openSessionSchema = z.object({
  body: z.object({
    openingAmount: z.number().min(0, 'Opening amount must be non-negative'),
    notes: z.string().optional(),
  }),
});

export const closeSessionSchema = z.object({
  body: z.object({
    // Physical cash counted in the drawer at close.
    closingAmount: z.number().min(0, 'Closing amount must be non-negative'),
    // §8.3 — petty cash spent (amount + reason) and cash dropped to the safe.
    pettyCash: z.number().min(0).optional(),
    pettyCashReason: z.string().optional(),
    cashDrop: z.number().min(0).optional(),
    // §8.4 — required when the net variance exceeds the auto-approve threshold.
    managerPin: z.string().optional(),
    varianceReason: z.string().optional(),
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
          agentId: z.number().int().positive().optional(),
          // Cashier flags this line as sold as-is (clearance/defective) — blocks returns.
          nonReturnable: z.boolean().optional(),
        })
      )
      .min(1, 'At least one item is required'),
    customerId: z.number().int().positive().optional(),
    // Sales channel drives the bill-number prefix (walk-in W-0001 / online O-0001).
    channel: z.enum(['walkin', 'online']).optional(),
    // Idempotency key — repeat checkouts with the same key return the original sale.
    clientRef: z.string().min(1).max(100).optional(),
    // Offline bill being synced (MRP-only pricing, stock-tolerant).
    offline: z.boolean().optional(),
    // Usually ≥1 payment, but an even exchange (return credit exactly covers
    // the new purchase) settles at ₹0 with no tender. The service validates
    // that payments actually cover the net payable, so empty is safe.
    payments: z
      .array(
        z.object({
          method: z.enum(['cash', 'card', 'upi']),
          amount: z.number().positive(),
          referenceNumber: z.string().optional(),
          // Bank/account name for card/UPI reconciliation.
          identifier: z.string().optional(),
        })
      ),
    // Gift vouchers redeemed as a tender (code + amount applied to this bill).
    vouchers: z
      .array(
        z.object({
          code: z.string().min(1),
          amount: z.number().positive(),
        })
      )
      .optional(),
    // Negative values are allowed to accommodate round-up surcharges
    // (the cashier bumps the total to the next ₹10). Capped at ₹10 on
    // the negative side so a stray sign can't turn into a huge surcharge.
    discountAmount: z.number().gte(-10).optional(),
    // §12 — flat special-discount portion, persisted separately for the breakup.
    specialDiscount: z.number().min(0).optional(),
    loyaltyPointsRedeem: z.number().int().min(0).optional(),
    notes: z.string().optional(),
    // Optional exchange: goods returned from a previous sale, credited against
    // this purchase. The new items are `items` above (scanned as normal). The
    // backend computes the return credit and the customer pays the difference.
    // A net refund (credit > purchase) is rejected — handle it in the Sales tab.
    exchange: z
      .object({
        originalSaleId: z.number().int().positive(),
        returnItems: z
          .array(
            z.object({
              saleItemId: z.number().int().positive(),
              quantity: z.number().int().positive(),
              condition: z.enum(['resellable', 'damaged']),
            })
          )
          .min(1, 'At least one return item is required'),
        reason: z.string().optional(),
      })
      .optional(),
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

export const evaluateCartSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          variantId: z.number().int().positive(),
          quantity: z.number().int().positive(),
        })
      )
      .min(1, 'At least one item is required'),
  }),
});
