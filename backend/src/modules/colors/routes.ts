import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { createColorSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/', controller.listColors);
router.post(
  '/',
  authorize('owner', 'manager'),
  validate(createColorSchema),
  controller.createColor
);

export default router;
