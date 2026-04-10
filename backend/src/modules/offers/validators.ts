import { z } from 'zod';

const offerTypeEnum = z.enum([
  'percentage',
  'flat',
  'buy_x_get_y_free',
  'buy_x_get_y_percent',
  'bundle',
]);

const offerBodySchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(120),
    description: z.string().max(500).optional().nullable(),
    type: offerTypeEnum,
    percentValue: z.number().min(0).max(100).optional().nullable(),
    flatValue: z.number().min(0).optional().nullable(),
    buyQty: z.number().int().min(1).optional().nullable(),
    getQty: z.number().int().min(1).optional().nullable(),
    priority: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
  })
  .refine(
    (data) => {
      // Type-specific field requirements
      switch (data.type) {
        case 'percentage':
          return data.percentValue != null && data.percentValue > 0;
        case 'flat':
          return data.flatValue != null && data.flatValue > 0;
        case 'buy_x_get_y_free':
          return (
            data.buyQty != null &&
            data.buyQty > 0 &&
            data.getQty != null &&
            data.getQty > 0
          );
        case 'buy_x_get_y_percent':
          return (
            data.buyQty != null &&
            data.buyQty > 0 &&
            data.percentValue != null &&
            data.percentValue > 0
          );
        case 'bundle':
          return (
            data.buyQty != null &&
            data.buyQty > 0 &&
            data.flatValue != null &&
            data.flatValue > 0
          );
        default:
          return false;
      }
    },
    {
      message:
        'Missing required fields for this offer type (percentValue/flatValue/buyQty/getQty).',
    }
  );

export const createOfferSchema = z.object({ body: offerBodySchema });
export const updateOfferSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: offerBodySchema,
});

export const offerIdSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
});

export const assignmentsSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({
    productIds: z.array(z.number().int().positive()).default([]),
    variantIds: z.array(z.number().int().positive()).default([]),
  }),
});

export const listOffersSchema = z.object({
  query: z.object({
    isActive: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
    type: offerTypeEnum.optional(),
  }),
});
