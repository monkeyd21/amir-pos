import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { posController } from './controller';
import {
  openSessionSchema,
  closeSessionSchema,
  checkoutSchema,
  holdCartSchema,
  heldIdParamSchema,
  createUpiPaymentSchema,
  checkUpiPaymentSchema,
  evaluateCartSchema,
} from './validators';

const router = Router();

router.use(authenticate);

// Sessions
router.post('/sessions/open', validate(openSessionSchema), posController.openSession);
router.post('/sessions/close', validate(closeSessionSchema), posController.closeSession);
router.get('/sessions/current', posController.currentSession);

// UPI payments
router.post('/upi/create', authorize('owner', 'manager', 'cashier'), validate(createUpiPaymentSchema), posController.createUpiPayment);
router.get('/upi/:intentId/status', validate(checkUpiPaymentSchema), posController.checkUpiPaymentStatus);

// Product search & barcode lookup
router.get('/products/search', posController.searchProducts);
router.get('/lookup/:barcode', posController.lookupBarcode);

// Cart evaluation — returns applicable offers and computed discounts
router.post('/cart/evaluate', validate(evaluateCartSchema), posController.evaluateCart);

// Checkout
router.post(
  '/checkout',
  authorize('owner', 'manager', 'cashier'),
  validate(checkoutSchema),
  posController.checkout
);

// Hold/Resume
router.post('/hold', validate(holdCartSchema), posController.holdCart);
router.get('/held', posController.listHeld);
router.delete('/held/:id', validate(heldIdParamSchema), posController.deleteHeld);
router.post('/held/:id/resume', validate(heldIdParamSchema), posController.resumeHeld);

export default router;
