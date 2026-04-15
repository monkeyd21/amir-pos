import { z } from 'zod';

// ─── Element IR ─────────────────────────────────────────────────

const elementTypeEnum = z.enum([
  'brand',
  'productName',
  'variant',
  'barcode',
  'sku',
  'price',
  'text',
]);

const alignEnum = z.enum(['left', 'center', 'right']);
const weightEnum = z.enum(['normal', 'bold']);
const barcodeTypeEnum = z.enum([
  'code128',
  'code39',
  'ean13',
  'ean8',
  'upca',
  'qr',
]);

const labelElementSchema = z.object({
  id: z.string().min(1),
  type: elementTypeEnum,
  xMm: z.number().min(0).max(500),
  yMm: z.number().min(0).max(500),
  visible: z.boolean().optional(),
  fontSizePt: z.number().positive().max(72).optional().nullable(),
  weight: weightEnum.optional().nullable(),
  align: alignEnum.optional().nullable(),
  widthMm: z.number().positive().max(500).optional().nullable(),
  underline: z.boolean().optional().nullable(),
  content: z.string().optional().nullable(),
  barcodeType: barcodeTypeEnum.optional().nullable(),
  barcodeHeightMm: z.number().positive().max(500).optional().nullable(),
  showBarcodeText: z.boolean().optional().nullable(),
});

// ─── Connection schema ──────────────────────────────────────────

const connectionSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().positive().max(65535).optional(),
  devicePath: z.string().optional(),
  queueName: z.string().optional(),
});

// ─── Profile schemas ────────────────────────────────────────────

const driverEnum = z.enum(['tspl', 'zpl', 'epl2', 'escpos-label', 'pdf']);
const transportEnum = z.enum(['tcp', 'usb-lp', 'cups', 'win-spool', 'browser']);

export const createProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    vendor: z.string().max(50).optional(),
    model: z.string().max(100).nullable().optional(),
    driver: driverEnum,
    transport: transportEnum,
    connection: connectionSchema,
    dpi: z.number().int().positive().max(1200).optional(),
    maxWidthMm: z.number().positive().max(500).optional(),
    capabilities: z.record(z.any()).optional(),
    isDefault: z.boolean().optional(),
  }),
});

export const updateProfileSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    vendor: z.string().max(50).optional(),
    model: z.string().max(100).nullable().optional(),
    driver: driverEnum.optional(),
    transport: transportEnum.optional(),
    connection: connectionSchema.optional(),
    dpi: z.number().int().positive().max(1200).optional(),
    maxWidthMm: z.number().positive().max(500).optional(),
    capabilities: z.record(z.any()).optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const profileIdParamSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
});

// ─── Template schemas ───────────────────────────────────────────

export const createTemplateSchema = z.object({
  params: z.object({ profileId: z.string().regex(/^\d+$/) }),
  body: z.object({
    name: z.string().min(1).max(100),
    widthMm: z.number().positive().max(500),
    heightMm: z.number().positive().max(500),
    gapMm: z.number().min(0).max(20).optional(),
    density: z.number().int().min(0).max(15).optional(),
    speed: z.number().int().min(1).max(14).optional(),
    elements: z.array(labelElementSchema),
    isDefault: z.boolean().optional(),
  }),
});

export const updateTemplateSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    widthMm: z.number().positive().max(500).optional(),
    heightMm: z.number().positive().max(500).optional(),
    gapMm: z.number().min(0).max(20).optional(),
    density: z.number().int().min(0).max(15).optional(),
    speed: z.number().int().min(1).max(14).optional(),
    elements: z.array(labelElementSchema).optional(),
    isDefault: z.boolean().optional(),
  }),
});

export const templateIdParamSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
});

export const listTemplatesSchema = z.object({
  params: z.object({ profileId: z.string().regex(/^\d+$/) }),
});

// ─── Print + test print ────────────────────────────────────────

const labelDataSchema = z.object({
  sku: z.string().min(1),
  productName: z.string().min(1),
  variantLabel: z.string().optional(),
  price: z.number().nonnegative(),
  copies: z.number().int().positive().max(99).optional(),
});

export const printSchema = z.object({
  body: z.object({
    profileId: z.number().int().positive().optional(),
    templateId: z.number().int().positive().optional(),
    items: z.array(labelDataSchema).min(1).max(500),
  }),
});

export const testPrintSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z
    .object({
      templateId: z.number().int().positive().optional(),
      overrideTemplate: z
        .object({
          widthMm: z.number().positive().max(500),
          heightMm: z.number().positive().max(500),
          gapMm: z.number().min(0).max(20),
          density: z.number().int().min(0).max(15),
          speed: z.number().int().min(1).max(14),
          elements: z.array(labelElementSchema),
        })
        .optional(),
    })
    .optional(),
});
