import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { paymentsController } from './controller';
import {
  recordPaymentSchema,
  refundPaymentSchema,
  paymentSummarySchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  authorize('owner', 'manager', 'cashier'),
  validate(recordPaymentSchema),
  paymentsController.recordPayment
);

router.post(
  '/:id/refund',
  authorize('owner', 'manager'),
  validate(refundPaymentSchema),
  paymentsController.refundPayment
);

router.get('/summary', validate(paymentSummarySchema), paymentsController.summary);

export default router;
