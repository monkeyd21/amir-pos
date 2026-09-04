import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { salesController } from './controller';
import {
  listSalesSchema,
  saleIdParamSchema,
  processReturnSchema,
  processExchangeSchema,
  approveExchangeOverrideSchema,
  returnableByBarcodeSchema,
  rejectInspectionSchema,
  updateBillCustomerSchema,
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
  authorize('owner', 'manager', 'cashier', 'staff'),
  validate(processReturnSchema),
  salesController.processReturn
);
router.post(
  '/:saleId/exchange',
  authorize('owner', 'manager', 'cashier', 'staff'),
  validate(processExchangeSchema),
  salesController.processExchange
);

// §0: a manager or owner authorises a second exchange on a bill that has
// already been exchanged. The cashier's terminal makes the call; the approver's
// own credentials in the body are what authorise it, so every role may POST.
router.post(
  '/:saleId/exchange-override',
  authorize('owner', 'manager', 'cashier', 'staff'),
  validate(approveExchangeOverrideSchema),
  salesController.approveExchangeOverride
);

// §1.2a — log a failed-inspection rejection. No return/exchange txn, no
// inventory movement — just an audit record of the refused attempt.
router.post(
  '/:saleId/reject',
  authorize('owner', 'manager', 'cashier', 'staff'),
  validate(rejectInspectionSchema),
  salesController.rejectInspection
);

// bug5 — limited bill editing. Customer name/contact only; a closed bill's
// money (lines, prices, totals, payments) stays immutable. Owner/manager only,
// and every edit is audited with before/after.
//
// OPEN QUESTION, not yet settled: `PUT /customers/:id` has no role gate, so a
// cashier refused here can still make the identical edit to the same Customer
// row from the customers screen. The two routes should agree, and which way
// they agree (gate the customers route, or open this one) is a decision for
// the owner. Until then this stays as it is.
router.put(
  '/:saleId/customer',
  authorize('owner', 'manager'),
  validate(updateBillCustomerSchema),
  salesController.updateBillCustomer
);

// Agent assignment (retroactive and current)
router.put(
  '/:saleId/agents',
  authorize('owner', 'manager'),
  salesController.assignAgents
);

export default router;
