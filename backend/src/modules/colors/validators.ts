import { z } from 'zod';

export const createColorSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(50),
    // Accept 3- or 6-digit hex with optional leading #
    hex: z
      .string()
      .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Hex must be a valid color (e.g. #0F172A)')
      .optional()
      .nullable(),
  }),
});
