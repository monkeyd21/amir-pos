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
} from './validators';

const router = Router();

router.use(authenticate);

// Sessions
router.post('/sessions/open', validate(openSessionSchema), posController.openSession);
router.post('/sessions/close', validate(closeSessionSchema), posController.closeSession);
router.get('/sessions/current', posController.currentSession);

// Product search & barcode lookup
router.get('/products/search', posController.searchProducts);
router.get('/lookup/:barcode', posController.lookupBarcode);

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
