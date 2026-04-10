import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { inventoryController } from './controller';
import {
  listInventorySchema,
  adjustStockSchema,
  createTransferSchema,
  transferParamsSchema,
  listMovementsSchema,
  printBarcodesSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listInventorySchema), inventoryController.list);
router.get('/low-stock', inventoryController.lowStock);
router.post(
  '/adjust',
  authorize('owner', 'manager'),
  validate(adjustStockSchema),
  inventoryController.adjust
);
router.get('/transfer', inventoryController.listTransfers);
router.post(
  '/transfer',
  authorize('owner', 'manager'),
  validate(createTransferSchema),
  inventoryController.createTransfer
);
router.put(
  '/transfer/:id/approve',
  authorize('owner', 'manager'),
  validate(transferParamsSchema),
  inventoryController.approveTransfer
);
router.put(
  '/transfer/:id/receive',
  authorize('owner', 'manager'),
  validate(transferParamsSchema),
  inventoryController.receiveTransfer
);
router.post(
  '/barcodes/print',
  validate(printBarcodesSchema),
  inventoryController.printBarcodes
);
router.post('/barcodes/test-print', inventoryController.testPrintBarcode);
router.get('/movements', validate(listMovementsSchema), inventoryController.movements);

export default router;
