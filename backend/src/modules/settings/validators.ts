import { z } from 'zod';

const elementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['brand', 'productName', 'variant', 'barcode', 'sku', 'price', 'text']),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  visible: z.boolean().optional(),
  font: z.number().int().min(1).max(5).optional(),
  xScale: z.number().int().min(1).max(10).optional(),
  yScale: z.number().int().min(1).max(10).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  width: z.number().int().positive().optional(),
  content: z.string().optional(),
  barcodeHeight: z.number().int().min(20).max(400).optional(),
  showBarcodeText: z.boolean().optional(),
  bold: z.boolean().optional(),
  underline: z.boolean().optional(),
});

export const labelTemplateSchema = z.object({
  body: z.object({
    widthMm: z.number().min(10).max(200),
    heightMm: z.number().min(10).max(300),
    gapMm: z.number().min(0).max(20),
    density: z.number().int().min(0).max(15),
    speed: z.number().int().min(1).max(14),
    elements: z.array(elementSchema).max(30),
  }),
});
