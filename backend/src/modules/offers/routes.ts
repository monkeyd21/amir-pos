import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { offersController } from './controller';
import {
  createOfferSchema,
  updateOfferSchema,
  offerIdSchema,
  assignmentsSchema,
  listOffersSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listOffersSchema), offersController.list);
router.get('/:id', validate(offerIdSchema), offersController.get);
router.post(
  '/',
  authorize('owner', 'manager'),
  validate(createOfferSchema),
  offersController.create
);
router.put(
  '/:id',
  authorize('owner', 'manager'),
  validate(updateOfferSchema),
  offersController.update
);
router.delete(
  '/:id',
  authorize('owner', 'manager'),
  validate(offerIdSchema),
  offersController.delete
);
router.put(
  '/:id/assignments',
  authorize('owner', 'manager'),
  validate(assignmentsSchema),
  offersController.setAssignments
);

export default router;
