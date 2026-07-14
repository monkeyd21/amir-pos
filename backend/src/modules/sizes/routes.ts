import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { createSizeSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/', controller.listSizes);
router.post(
  '/',
  authorize('owner', 'manager'),
  validate(createSizeSchema),
  controller.createSize
);

export default router;
