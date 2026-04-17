import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { inventoryController } from './controller';
import {
  listInventorySchema,
  adjustStockSchema,
  restockSchema,
  createTransferSchema,
  transferParamsSchema,
  updateMovementSchema,
  listMovementsSchema,
} from './validators';
import { upload } from '../../middleware/upload';

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
router.post(
  '/restock',
  authorize('owner', 'manager'),
  validate(restockSchema),
  inventoryController.restock
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
router.get('/movements', validate(listMovementsSchema), inventoryController.movements);
router.put(
  '/movements/:id',
  authorize('owner', 'manager'),
  validate(updateMovementSchema),
  inventoryController.updateMovement
);

// Import
router.get('/import/template', inventoryController.importTemplate);
router.post(
  '/import/preview',
  authorize('owner', 'manager'),
  upload.single('file'),
  inventoryController.importPreview
);
router.post(
  '/import/execute',
  authorize('owner', 'manager'),
  inventoryController.importExecute
);

export default router;
