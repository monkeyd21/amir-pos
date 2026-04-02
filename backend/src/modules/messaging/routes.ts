import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { messagingController } from './controller';
import { sendBillSchema, sendCustomSchema, listLogsSchema } from './validators';

const router = Router();

router.use(authenticate);

router.post('/send-bill', validate(sendBillSchema), (req, res, next) =>
  messagingController.sendBill(req, res, next)
);

router.post('/send-custom', validate(sendCustomSchema), (req, res, next) =>
  messagingController.sendCustom(req, res, next)
);

router.get('/logs', validate(listLogsSchema), (req, res, next) =>
  messagingController.listLogs(req, res, next)
);

export default router;
