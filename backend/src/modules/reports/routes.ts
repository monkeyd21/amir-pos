import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { reportController } from './controller';
import {
  salesReportSchema,
  inventoryReportSchema,
  customerReportSchema,
  commissionReportSchema,
  pnlReportSchema,
  dailySummarySchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/sales', validate(salesReportSchema), (req, res, next) =>
  reportController.salesReport(req, res, next)
);

router.get('/inventory', validate(inventoryReportSchema), (req, res, next) =>
  reportController.inventoryReport(req, res, next)
);

router.get('/customers', validate(customerReportSchema), (req, res, next) =>
  reportController.customerReport(req, res, next)
);

router.get('/commissions', validate(commissionReportSchema), (req, res, next) =>
  reportController.commissionReport(req, res, next)
);

router.get('/pnl', validate(pnlReportSchema), (req, res, next) =>
  reportController.pnlReport(req, res, next)
);

router.get('/daily-summary', validate(dailySummarySchema), (req, res, next) =>
  reportController.dailySummary(req, res, next)
);

// §10 — business performance (profit summary, day-of-week, monthly + insights).
router.get('/performance', (req, res, next) =>
  reportController.performance(req, res, next)
);

// §2.3 — monthly Owner Discretion Discount review (owner/manager).
router.get('/discretionary-discounts', authorize('owner', 'manager'), (req, res, next) =>
  reportController.discretionaryDiscounts(req, res, next)
);

export default router;
