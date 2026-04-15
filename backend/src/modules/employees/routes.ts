import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { employeeController } from './controller';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  clockInSchema,
  clockOutSchema,
  listAttendanceSchema,
  attendanceSummarySchema,
  listCommissionsSchema,
  calculateCommissionsSchema,
  payCommissionSchema,
  commissionSummarySchema,
} from './validators';

const router = Router();

router.use(authenticate);

// Employee CRUD
router.get('/', (req, res, next) => employeeController.list(req, res, next));
router.post('/', authorize('owner', 'manager'), validate(createEmployeeSchema), (req, res, next) => employeeController.create(req, res, next));
router.put('/:id', authorize('owner', 'manager'), validate(updateEmployeeSchema), (req, res, next) => employeeController.update(req, res, next));

// Attendance
router.post('/attendance/clock-in', validate(clockInSchema), (req, res, next) =>
  employeeController.clockIn(req, res, next)
);

router.post('/attendance/clock-out', (req, res, next) =>
  employeeController.clockOut(req, res, next)
);

router.get('/attendance', validate(listAttendanceSchema), (req, res, next) =>
  employeeController.listAttendance(req, res, next)
);

router.get('/attendance/summary', validate(attendanceSummarySchema), (req, res, next) =>
  employeeController.getAttendanceSummary(req, res, next)
);

// Commissions
router.get('/commissions', validate(listCommissionsSchema), (req, res, next) =>
  employeeController.listCommissions(req, res, next)
);

router.get('/commissions/calculate', authorize('owner', 'manager'), validate(calculateCommissionsSchema), (req, res, next) =>
  employeeController.calculateCommissions(req, res, next)
);

router.get('/commissions/summary', validate(commissionSummarySchema), (req, res, next) =>
  employeeController.getCommissionSummary(req, res, next)
);

router.post('/commissions/pay-bulk', authorize('owner', 'manager'), (req, res, next) =>
  employeeController.payCommissionsBulk(req, res, next)
);

router.put('/commissions/:id/pay', authorize('owner', 'manager'), validate(payCommissionSchema), (req, res, next) =>
  employeeController.payCommission(req, res, next)
);

export default router;

