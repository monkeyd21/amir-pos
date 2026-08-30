import { z } from 'zod';

// §6 of CLAUDE.md — `.optional()` rejects null, and a dropdown with a
// "Select…" option sends null. Anything that can come from a form field that
// may be cleared is `.optional().nullable()`.

export const listProductsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    category: z.string().optional(),
    audience: z.enum(['girls', 'boys', 'unisex']).optional(),
    age: z.string().optional(),
    size: z.string().optional(),
    sort: z.enum(['new', 'price-asc', 'price-desc', 'name']).optional(),
    q: z.string().optional(),
    newIn: z.string().optional(),
    sale: z.string().optional(),
  }),
});

export const productSlugSchema = z.object({
  params: z.object({ slug: z.string().min(1) }),
});

export const addItemSchema = z.object({
  body: z.object({
    variantId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(20).default(1),
  }),
});

export const updateItemSchema = z.object({
  params: z.object({ itemId: z.string().regex(/^\d+$/) }),
  body: z.object({ quantity: z.number().int().min(0).max(20) }),
});

export const otpRequestSchema = z.object({
  body: z.object({ phone: z.string().min(10) }),
});

export const otpVerifySchema = z.object({
  body: z.object({
    phone: z.string().min(10),
    code: z.string().min(4).max(8),
    firstName: z.string().optional().nullable(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(10) }),
});

const addressBody = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(10, 'A 10-digit phone number is required'),
  line1: z.string().min(1, 'Address is required'),
  line2: z.string().optional().nullable(),
  landmark: z.string().optional().nullable(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode'),
  isDefault: z.boolean().optional(),
});

export const createAddressSchema = z.object({ body: addressBody });
export const updateAddressSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: addressBody,
});

export const quoteSchema = z.object({
  body: z.object({
    paymentMode: z.enum(['prepaid', 'cod']).optional(),
    loyaltyPointsRedeem: z.number().int().min(0).optional().nullable(),
  }),
});

export const placeOrderSchema = z.object({
  body: z.object({
    addressId: z.number().int().positive(),
    paymentMode: z.enum(['prepaid', 'cod']).optional(),
    loyaltyPointsRedeem: z.number().int().min(0).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  }),
});

export const orderNumberSchema = z.object({
  params: z.object({ orderNumber: z.string().min(1) }),
});
