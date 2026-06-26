import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { voucherService } from './service';
import {
  createVoucherSchema,
  listVouchersSchema,
  voucherCodeParamSchema,
  voucherIdParamSchema,
} from './validators';

const router = Router();

router.use(authenticate);

// Lookup by code — any cashier needs this to redeem at the till.
// Registered before '/:id'-style routes; code path is its own namespace.
router.get('/lookup/:code', validate(voucherCodeParamSchema), async (req: AuthRequest, res, next) => {
  try {
    const voucher = await voucherService.lookup(req.params.code);
    res.json({ success: true, data: voucher });
  } catch (error) {
    next(error);
  }
});

router.get('/', validate(listVouchersSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await voucherService.list(req.query as any);
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  authorize('owner', 'manager'),
  validate(createVoucherSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const voucher = await voucherService.create(req.body, req.user!.userId, req.user!.branchId);
      res.status(201).json({ success: true, data: voucher, message: 'Voucher created' });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/cancel',
  authorize('owner', 'manager'),
  validate(voucherIdParamSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const voucher = await voucherService.cancel(parseInt(req.params.id), req.user!.userId, req.user!.branchId);
      res.json({ success: true, data: voucher, message: 'Voucher cancelled' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
