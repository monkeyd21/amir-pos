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
  quickCreateProductSchema,
} from './validators';

const router = Router();

router.use(authenticate);

// Sessions
router.post('/sessions/open', validate(openSessionSchema), posController.openSession);
router.post('/sessions/close', validate(closeSessionSchema), posController.closeSession);
router.get('/sessions/current', posController.currentSession);
// §8.0 — Day-Start: suggested opening balance (last shift's closing float).
router.get('/sessions/suggested-opening', posController.suggestedOpening);
// §8 — EOD preview: expected cash for the open session (no mutation).
router.get('/sessions/expected', posController.sessionExpected);

// UPI payments
router.post('/upi/create', authorize('owner', 'manager', 'cashier', 'staff'), validate(createUpiPaymentSchema), posController.createUpiPayment);
router.get('/upi/:intentId/status', validate(checkUpiPaymentSchema), posController.checkUpiPaymentStatus);

// Product search & barcode lookup
router.get('/products/search', posController.searchProducts);
router.get('/lookup/:barcode', posController.lookupBarcode);

// Case B — quick-add a ghost product (physical item with no record) at the counter.
router.post(
  '/quick-product',
  authorize('owner', 'manager', 'cashier', 'staff'),
  validate(quickCreateProductSchema),
  posController.quickCreateProduct
);

// Catalog snapshot for offline caching (scan + price with no network)
router.get('/catalog', posController.catalog);

// Cart evaluation — returns applicable offers and computed discounts
router.post('/cart/evaluate', validate(evaluateCartSchema), posController.evaluateCart);

// Checkout
router.post(
  '/checkout',
  authorize('owner', 'manager', 'cashier', 'staff'),
  validate(checkoutSchema),
  posController.checkout
);

// bug3 — UPI collection at the counter. The QR used to exist only on the
// printed receipt, i.e. after the customer had already paid; the cashier needs
// it during the payment step. `accounts` lists what the store can collect into
// so the cashier can pick, `qr` renders the deep link for the amount due.
router.get('/upi/accounts', posController.upiAccounts);
router.post('/upi/qr', posController.upiQr);

// Hold/Resume
router.post('/hold', validate(holdCartSchema), posController.holdCart);
router.get('/held', posController.listHeld);
router.delete('/held/:id', validate(heldIdParamSchema), posController.deleteHeld);
router.post('/held/:id/resume', validate(heldIdParamSchema), posController.resumeHeld);

export default router;
