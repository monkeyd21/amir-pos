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

export default router;
