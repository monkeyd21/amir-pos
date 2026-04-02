import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { customerController } from './controller';
import {
  createCustomerSchema,
  updateCustomerSchema,
  getCustomerSchema,
  listCustomersSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listCustomersSchema), (req, res, next) =>
  customerController.list(req, res, next)
);

router.get('/search', validate(listCustomersSchema), (req, res, next) =>
  customerController.list(req, res, next)
);

router.get('/:id', validate(getCustomerSchema), (req, res, next) =>
  customerController.getById(req, res, next)
);

router.post('/', validate(createCustomerSchema), (req, res, next) =>
  customerController.create(req, res, next)
);

router.put('/:id', validate(updateCustomerSchema), (req, res, next) =>
  customerController.update(req, res, next)
);

router.get('/:id/history', validate(getCustomerSchema), (req, res, next) =>
  customerController.getPurchaseHistory(req, res, next)
);

router.get('/:id/loyalty', validate(getCustomerSchema), (req, res, next) =>
  customerController.getLoyaltyHistory(req, res, next)
);

export default router;
