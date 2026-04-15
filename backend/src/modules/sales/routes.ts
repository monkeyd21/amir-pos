import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { salesController } from './controller';
import {
  listSalesSchema,
  saleIdParamSchema,
  processReturnSchema,
  processExchangeSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listSalesSchema), salesController.list);
router.get('/:id', validate(saleIdParamSchema), salesController.getById);
router.get('/:id/receipt', validate(saleIdParamSchema), salesController.receipt);

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

// Agent assignment (retroactive and current)
router.put(
  '/:saleId/agents',
  authorize('owner', 'manager'),
  salesController.assignAgents
);

export default router;
