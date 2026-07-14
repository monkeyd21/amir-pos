import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => ({
          // Drop the leading source segment (body./query./params.) so the field
          // name reads naturally to a cashier, e.g. "specialDiscount" not
          // "body.specialDiscount".
          field: e.path.slice(1).join('.') || e.path.join('.'),
          message: e.message,
        }));
        // §bug7 — surface the EXACT reasons in the top-level `error` string (the
        // one the frontend interceptor shows), not a generic "Validation failed".
        // e.g. "specialDiscount: Number must be greater than or equal to 0".
        const summary = messages
          .map((m) => (m.field ? `${m.field}: ${m.message}` : m.message))
          .join('; ');
        return res.status(400).json({
          success: false,
          error: summary || 'Validation failed',
          details: messages,
        });
      }
      next(error);
    }
  };
};
