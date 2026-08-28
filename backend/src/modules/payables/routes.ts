import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { payableController } from './controller';
import {
  createCategorySchema,
  createPayableSchema,
  ensureMonthSchema,
  idParamSchema,
  listPayablesSchema,
  outstandingSchema,
  payPayableSchema,
  summarySchema,
  updateCategorySchema,
  updatePayableSchema,
} from './validators';

const router = Router();

router.use(authenticate);

// Reading the books is an owner/manager/staff concern; a cashier has no
// business seeing what the store owes.
const canRead = authorize('owner', 'manager', 'staff');
const canWrite = authorize('owner', 'manager');

// ─── STATIC ROUTES FIRST — '/categories' would otherwise be eaten by '/:id' ──
router.get('/categories', canRead, payableController.listCategories);
router.post('/categories', canWrite, validate(createCategorySchema), payableController.createCategory);
router.put('/categories/:id', canWrite, validate(updateCategorySchema), payableController.updateCategory);

router.get('/outstanding', canRead, validate(outstandingSchema), payableController.outstanding);
router.get('/summary', canRead, validate(summarySchema), payableController.summary);
router.post('/ensure-month', canWrite, validate(ensureMonthSchema), payableController.ensureMonth);

// ─── Parameterised routes ───────────────────────────────────────────────────
router.get('/', canRead, validate(listPayablesSchema), payableController.list);
router.post('/', canWrite, validate(createPayableSchema), payableController.create);
router.get('/:id', canRead, validate(idParamSchema), payableController.getById);
router.put('/:id', canWrite, validate(updatePayableSchema), payableController.update);
router.post('/:id/pay', canWrite, validate(payPayableSchema), payableController.pay);
router.delete('/:id', canWrite, validate(idParamSchema), payableController.void);

export default router;
