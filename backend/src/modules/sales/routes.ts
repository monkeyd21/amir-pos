import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { salesController } from './controller';
import {
  listSalesSchema,
  saleIdParamSchema,
  processReturnSchema,
  processExchangeSchema,
  returnableByBarcodeSchema,
  editSaleSchema,
  voidSaleSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listSalesSchema), salesController.list);
// Static route MUST precede '/:id' so "returnable" isn't matched as an id.
router.get(
  '/returnable/:barcode',
  validate(returnableByBarcodeSchema),
  salesController.returnableByBarcode
);
router.get('/:id', validate(saleIdParamSchema), salesController.getById);
router.get('/:id/receipt', validate(saleIdParamSchema), salesController.receipt);
router.get('/:id/receipt.pdf', validate(saleIdParamSchema), salesController.receiptPdf);

// Returns and exchanges
router.post(
  '/:saleId/return',
  authorize('owner', 'manager', 'cashier'),
  validate(processReturnSchema),
  salesController.processReturn
);
router.post(
  '/:saleId/exchange',
  authorize('owner', 'manager', 'cashier'),
  validate(processExchangeSchema),
  salesController.processExchange
);

// §1.4 — same-day VOID (supervisor PIN; restores inventory, no return txn).
router.post(
  '/:saleId/void',
  authorize('owner', 'manager', 'cashier'),
  validate(voidSaleSchema),
  salesController.voidSale
);

// Edit a completed bill (manager/owner) — recomputes pricing, reconciles
// inventory/loyalty/commission, and settles the payment difference.
router.put(
  '/:saleId/edit',
  authorize('owner', 'manager'),
  validate(editSaleSchema),
  salesController.editSale
);

// Agent assignment (retroactive and current)
router.put(
  '/:saleId/agents',
  authorize('owner', 'manager'),
  salesController.assignAgents
);

export default router;
