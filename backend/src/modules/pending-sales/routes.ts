import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { pendingSaleService } from './service';

const router = Router();
router.use(authenticate);

const id = z.object({ id: z.string().regex(/^\d+$/) });

const captureSchema = z.object({
  body: z.object({
    items: z
      .array(z.object({ barcode: z.string().trim().min(1), quantity: z.number().int().positive().max(50) }))
      .min(1, 'Scan at least one piece')
      .max(50),
    paymentMode: z.enum(['cash', 'upi']),
    amountReceived: z.number().min(0),
    notes: z.string().max(500).optional().nullable(),
    clientRef: z.string().max(80).optional().nullable(),
    floorBasketId: z.number().int().positive().optional().nullable(),
  }),
});

const listSchema = z.object({
  query: z.object({ status: z.enum(['pending', 'finalized', 'voided']).optional() }),
});

const finalizeSchema = z.object({
  params: id,
  body: z.object({
    customerId: z.number().int().positive().optional().nullable(),
    discountAmount: z.number().min(0).optional(),
    payments: z
      .array(
        z.object({
          method: z.enum(['cash', 'card', 'upi']),
          amount: z.number().min(0),
          referenceNumber: z.string().optional(),
        })
      )
      .optional(),
    ownerPin: z.string().optional().nullable(),
  }),
});

const voidSchema = z.object({
  params: id,
  body: z.object({ reason: z.string().trim().min(3, 'Say why it is being voided').max(500) }),
});

const wrap =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) => (req: AuthRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// §15.5: any staff role can capture a pending sale…
router.post(
  '/',
  validate(captureSchema),
  wrap(async (req, res) => {
    const data = await pendingSaleService.capture(req.body, req.user!.userId, req.user!.branchId);
    res.status(201).json({ success: true, data });
  })
);

// …only an owner or manager sees and settles them.
router.get(
  '/',
  authorize('owner', 'manager'),
  validate(listSchema),
  wrap(async (req, res) => {
    const data = await pendingSaleService.list(req.user!.branchId, (req.query.status as any) ?? 'pending');
    res.json({ success: true, data });
  })
);

router.get(
  '/:id',
  authorize('owner', 'manager'),
  validate(z.object({ params: id })),
  wrap(async (req, res) => {
    res.json({ success: true, data: await pendingSaleService.get(Number(req.params.id), req.user!.branchId) });
  })
);

router.post(
  '/:id/finalize',
  authorize('owner', 'manager'),
  validate(finalizeSchema),
  wrap(async (req, res) => {
    const data = await pendingSaleService.finalize(
      Number(req.params.id),
      { ...req.body, ownerPin: req.body.ownerPin ?? undefined },
      req.user!.userId,
      req.user!.branchId
    );
    res.json({ success: true, data });
  })
);

router.post(
  '/:id/void',
  authorize('owner', 'manager'),
  validate(voidSchema),
  wrap(async (req, res) => {
    const data = await pendingSaleService.void(Number(req.params.id), req.body.reason, req.user!.userId, req.user!.branchId);
    res.json({ success: true, data });
  })
);

export default router;
