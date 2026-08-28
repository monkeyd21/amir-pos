import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { employeeController } from './controller';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  upsertAttendanceSchema,
  bulkAttendanceSchema,
  listAttendanceSchema,
  attendanceSummarySchema,
  payrollListSchema,
  payrollDetailSchema,
  finalisePayrollSchema,
  payPayrollSchema,
  reopenPayrollSchema,
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

// ─── Attendance (§3.2) ───────────────────────────────
// Attendance and payroll are owner/manager only — a cashier must never be able
// to mark their own day or anyone else's.

router.put('/attendance', authorize('owner', 'manager'), validate(upsertAttendanceSchema), (req, res, next) =>
  employeeController.upsertAttendance(req, res, next)
);

router.post('/attendance/bulk', authorize('owner', 'manager'), validate(bulkAttendanceSchema), (req, res, next) =>
  employeeController.bulkAttendance(req, res, next)
);

// STATIC before parameterised: /attendance/summary must not be eaten by a :param route.
router.get('/attendance/summary', authorize('owner', 'manager'), validate(attendanceSummarySchema), (req, res, next) =>
  employeeController.getAttendanceSummary(req, res, next)
);

router.get('/attendance', authorize('owner', 'manager'), validate(listAttendanceSchema), (req, res, next) =>
  employeeController.listAttendance(req, res, next)
);

// ─── Payroll (§3.3) ──────────────────────────────────
// The month list is registered before /payroll/:userId/:month so "payroll" with
// a query string can never be read as a userId.

router.get('/payroll', authorize('owner', 'manager'), validate(payrollListSchema), (req, res, next) =>
  employeeController.getPayroll(req, res, next)
);

router.post('/payroll/:userId/:month/finalise', authorize('owner', 'manager'), validate(finalisePayrollSchema), (req, res, next) =>
  employeeController.finalisePayroll(req, res, next)
);

router.post('/payroll/:userId/:month/pay', authorize('owner', 'manager'), validate(payPayrollSchema), (req, res, next) =>
  employeeController.payPayroll(req, res, next)
);

// Reopening a closed month is an owner-only correction.
router.post('/payroll/:userId/:month/reopen', authorize('owner'), validate(reopenPayrollSchema), (req, res, next) =>
  employeeController.reopenPayroll(req, res, next)
);

router.get('/payroll/:userId/:month', authorize('owner', 'manager'), validate(payrollDetailSchema), (req, res, next) =>
  employeeController.getPayrollDetail(req, res, next)
);

// ─── Commissions ─────────────────────────────────────

router.get('/commissions', authorize('owner', 'manager'), validate(listCommissionsSchema), (req, res, next) =>
  employeeController.listCommissions(req, res, next)
);

router.get('/commissions/calculate', authorize('owner', 'manager'), validate(calculateCommissionsSchema), (req, res, next) =>
  employeeController.calculateCommissions(req, res, next)
);

router.get('/commissions/summary', authorize('owner', 'manager'), validate(commissionSummarySchema), (req, res, next) =>
  employeeController.getCommissionSummary(req, res, next)
);

// §9.2 — commission statement (original → deductions → net per employee).
router.get('/commissions/statement', authorize('owner', 'manager'), validate(commissionSummarySchema), (req, res, next) =>
  employeeController.getCommissionStatement(req, res, next)
);

router.post('/commissions/pay-bulk', authorize('owner', 'manager'), (req, res, next) =>
  employeeController.payCommissionsBulk(req, res, next)
);

router.put('/commissions/:id/pay', authorize('owner', 'manager'), validate(payCommissionSchema), (req, res, next) =>
  employeeController.payCommission(req, res, next)
);

// Employee update stays LAST: '/:id' would otherwise swallow '/attendance' etc.
router.put('/:id', authorize('owner', 'manager'), validate(updateEmployeeSchema), (req, res, next) => employeeController.update(req, res, next));

export default router;
