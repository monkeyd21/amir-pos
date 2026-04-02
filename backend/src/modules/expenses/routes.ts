import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { expenseController } from './controller';
import {
  createExpenseSchema,
  updateExpenseSchema,
  getExpenseSchema,
  listExpensesSchema,
  createCategorySchema,
  updateCategorySchema,
  expenseSummarySchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/categories', (req, res, next) =>
  expenseController.listCategories(req, res, next)
);

router.post('/categories', validate(createCategorySchema), (req, res, next) =>
  expenseController.createCategory(req, res, next)
);

router.put('/categories/:id', validate(updateCategorySchema), (req, res, next) =>
  expenseController.updateCategory(req, res, next)
);

router.get('/summary', validate(expenseSummarySchema), (req, res, next) =>
  expenseController.getSummary(req, res, next)
);

router.get('/', validate(listExpensesSchema), (req, res, next) =>
  expenseController.list(req, res, next)
);

router.get('/:id', validate(getExpenseSchema), (req, res, next) =>
  expenseController.getById(req, res, next)
);

router.post('/', validate(createExpenseSchema), (req, res, next) =>
  expenseController.create(req, res, next)
);

router.put('/:id', validate(updateExpenseSchema), (req, res, next) =>
  expenseController.update(req, res, next)
);

router.put('/:id/approve', authorize('owner', 'manager'), validate(getExpenseSchema), (req, res, next) =>
  expenseController.approve(req, res, next)
);

router.put('/:id/reject', authorize('owner', 'manager'), validate(getExpenseSchema), (req, res, next) =>
  expenseController.reject(req, res, next)
);

export default router;
