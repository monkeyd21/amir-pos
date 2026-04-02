import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
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

export default router;
