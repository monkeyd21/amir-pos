import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { floorBasketService } from './service';

/**
 * §7.2 Salesfloor Scan. Every signed-in role may use it: salespeople scan,
 * cashiers pull baskets at the till.
 */
const router = Router();
router.use(authenticate);

const id = z.string().regex(/^\d+$/);
const wrap =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) => (req: AuthRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const who = (req: AuthRequest) => [req.user!.userId, req.user!.role, req.user!.branchId] as const;

router.post(
  '/',
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await floorBasketService.open(req.user!.userId, req.user!.branchId) });
  })
);

/** Open baskets: the cashier's pick list, or `?mine=1` for a salesperson's own. */
router.get(
  '/',
  validate(z.object({ query: z.object({ mine: z.enum(['1']).optional() }) })),
  wrap(async (req, res) => {
    const mine = req.query.mine === '1' ? req.user!.userId : undefined;
    res.json({ success: true, data: await floorBasketService.listOpen(req.user!.branchId, mine) });
  })
);

router.get(
  '/code/:code',
  validate(z.object({ params: z.object({ code: z.string().regex(/^\d{3}$/, 'A basket code is three digits') }) })),
  wrap(async (req, res) => {
    res.json({ success: true, data: await floorBasketService.byCode(req.params.code, req.user!.branchId) });
  })
);

router.post(
  '/:id/items',
  validate(z.object({ params: z.object({ id }), body: z.object({ barcode: z.string().trim().min(1) }) })),
  wrap(async (req, res) => {
    res.json({ success: true, data: await floorBasketService.scan(Number(req.params.id), req.body.barcode, ...who(req)) });
  })
);

router.delete(
  '/:id/items/:itemId',
  validate(z.object({ params: z.object({ id, itemId: id }) })),
  wrap(async (req, res) => {
    const data = await floorBasketService.removeLine(Number(req.params.id), Number(req.params.itemId), ...who(req));
    res.json({ success: true, data });
  })
);

router.post(
  '/:id/abandon',
  validate(z.object({ params: z.object({ id }) })),
  wrap(async (req, res) => {
    await floorBasketService.abandon(Number(req.params.id), ...who(req));
    res.json({ success: true, data: null });
  })
);

export default router;
