import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loyaltyController } from './controller';
import {
  updateConfigSchema,
  earnPointsSchema,
  redeemPointsSchema,
  adjustPointsSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/config', (req, res, next) =>
  loyaltyController.getConfig(req, res, next)
);

router.put('/config', authorize('owner'), validate(updateConfigSchema), (req, res, next) =>
  loyaltyController.updateConfig(req, res, next)
);

router.post('/earn', validate(earnPointsSchema), (req, res, next) =>
  loyaltyController.earnPoints(req, res, next)
);

router.post('/redeem', validate(redeemPointsSchema), (req, res, next) =>
  loyaltyController.redeemPoints(req, res, next)
);

router.post('/adjust', authorize('owner', 'manager'), validate(adjustPointsSchema), (req, res, next) =>
  loyaltyController.adjustPoints(req, res, next)
);

export default router;
