import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { upiCreditService } from './service';

const router = Router();
router.use(authenticate);
// §15.1: reconciling money is an owner/manager job.
router.use(authorize('owner', 'manager'));

const id = z.object({ id: z.string().regex(/^\d+$/) });
const row = z.object({
  receivedAt: z.string().min(1),
  amount: z.number().positive(),
  reference: z.string().trim().min(4),
  payerName: z.string().max(120).optional().nullable(),
  payerVpa: z.string().max(120).optional().nullable(),
});

const wrap =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) => (req: AuthRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

router.get(
  '/',
  validate(z.object({ query: z.object({ status: z.enum(['unmatched', 'matched', 'non_sale']).optional() }) })),
  wrap(async (req, res) => {
    res.json({ success: true, data: await upiCreditService.list(req.user!.branchId, req.query.status as any) });
  })
);

/** A statement, already parsed into rows by the browser (it knows the bank's column layout). */
router.post(
  '/import',
  validate(z.object({ body: z.object({ rows: z.array(row).min(1).max(5000) }) })),
  wrap(async (req, res) => {
    const data = await upiCreditService.import(req.body.rows, 'import', req.user!.userId, req.user!.branchId);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  '/',
  validate(z.object({ body: row })),
  wrap(async (req, res) => {
    const data = await upiCreditService.import([req.body], 'manual', req.user!.userId, req.user!.branchId);
    res.status(201).json({ success: true, data });
  })
);

router.get(
  '/:id/candidates',
  validate(z.object({ params: id })),
  wrap(async (req, res) => {
    res.json({ success: true, data: await upiCreditService.candidates(Number(req.params.id), req.user!.branchId) });
  })
);

router.post(
  '/:id/match',
  validate(
    z.object({
      params: id,
      body: z
        .object({ paymentId: z.number().int().positive().optional(), pendingSaleId: z.number().int().positive().optional() })
        .refine((b) => !!b.paymentId !== !!b.pendingSaleId, 'Pick exactly one bill or pending sale'),
    })
  ),
  wrap(async (req, res) => {
    const data = await upiCreditService.match(Number(req.params.id), req.body, req.user!.userId, req.user!.branchId);
    res.json({ success: true, data });
  })
);

router.post(
  '/:id/non-sale',
  validate(z.object({ params: id, body: z.object({ reason: z.string().trim().min(3, 'Say what this money was').max(300) }) })),
  wrap(async (req, res) => {
    const data = await upiCreditService.markNonSale(Number(req.params.id), req.body.reason, req.user!.userId, req.user!.branchId);
    res.json({ success: true, data });
  })
);

router.post(
  '/:id/reopen',
  validate(z.object({ params: id })),
  wrap(async (req, res) => {
    res.json({ success: true, data: await upiCreditService.reopen(Number(req.params.id), req.user!.userId, req.user!.branchId) });
  })
);

export default router;
