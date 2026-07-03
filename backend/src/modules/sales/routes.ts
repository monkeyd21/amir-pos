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
  rejectInspectionSchema,
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
// §1.3a — refund/exchange receipt (static, before '/:id').
router.get('/returns/:returnId/receipt', salesController.returnReceipt);
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

// §1.2a — log a failed-inspection rejection. No return/exchange txn, no
// inventory movement — just an audit record of the refused attempt.
router.post(
  '/:saleId/reject',
  authorize('owner', 'manager', 'cashier'),
  validate(rejectInspectionSchema),
  salesController.rejectInspection
);

// Agent assignment (retroactive and current)
router.put(
  '/:saleId/agents',
  authorize('owner', 'manager'),
  salesController.assignAgents
);

export default router;
