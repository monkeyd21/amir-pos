import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { settingsController } from './controller';
import { labelTemplateSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/label-template', settingsController.getLabelTemplate);
router.put(
  '/label-template',
  authorize('owner', 'manager'),
  validate(labelTemplateSchema),
  settingsController.updateLabelTemplate
);
router.post(
  '/label-template/reset',
  authorize('owner', 'manager'),
  settingsController.resetLabelTemplate
);

export default router;
