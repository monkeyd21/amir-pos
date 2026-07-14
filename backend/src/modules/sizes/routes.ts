import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import {
  createSizeSchema,
  updateSizeSchema,
  idParamSchema,
  reorderSizesSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', controller.listSizes);
router.post(
  '/',
  authorize('owner', 'manager'),
  validate(createSizeSchema),
  controller.createSize
);
// Static route before the parameterized :id route (§CLAUDE convention #5).
router.put(
  '/reorder',
  authorize('owner', 'manager'),
  validate(reorderSizesSchema),
  controller.reorderSizes
);
router.put(
  '/:id',
  authorize('owner', 'manager'),
  validate(updateSizeSchema),
  controller.updateSize
);
router.delete(
  '/:id',
  authorize('owner', 'manager'),
  validate(idParamSchema),
  controller.deleteSize
);

export default router;
