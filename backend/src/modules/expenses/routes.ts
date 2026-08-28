import { Router, NextFunction } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
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



router.get('/summary', validate(expenseSummarySchema), (req, res, next) =>
  expenseController.getSummary(req, res, next)
);

router.get('/', validate(listExpensesSchema), (req, res, next) =>
  expenseController.list(req, res, next)
);

router.get('/:id', validate(getExpenseSchema), (req, res, next) =>
  expenseController.getById(req, res, next)
);






/**
 * The expense WRITE surface is retired (spec §4.2 / §5).
 *
 * Spend now lives in `payables`, and the reports read money-out from
 * `payable_payments`. The legacy `expenses` table is kept read-only for one
 * release as a rollback net, but anything written to it after this deploy
 * would be counted NOWHERE — not in the daily summary, not in netRevenue, not
 * in /payables/outstanding. So the writes are closed rather than left as a
 * silent money leak. The reads stay open so old rows remain inspectable.
 */
const retired = (replacement: string) => (_req: any, _res: any, next: NextFunction) =>
  next(
    new AppError(
      `This endpoint has been retired — use ${replacement} instead. Expenses are now recorded as payables.`,
      410
    )
  );

router.post('/', retired('POST /api/v1/payables'));
router.put('/:id', retired('PUT /api/v1/payables/:id'));
router.put('/:id/approve', retired('POST /api/v1/payables/:id/pay'));
router.put('/:id/reject', retired('DELETE /api/v1/payables/:id'));
router.post('/categories', retired('POST /api/v1/payables/categories'));
router.put('/categories/:id', retired('PUT /api/v1/payables/categories/:id'));

export default router;
