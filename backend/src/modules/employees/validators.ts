import { z } from 'zod';

const roleEnum = z.enum(['owner', 'manager', 'cashier', 'staff']);

// Blank strings from the form mean "not provided" for optional fields.
const emptyToNull = (v: unknown) => (v === '' || v == null ? null : v);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

export const attendanceStatusEnum = z.enum([
  'present',
  'absent',
  'half_day',
  'late',
  'paid_weekly_off',
]);

const salaryTypeEnum = z.enum(['fixed_monthly', 'daily_wage']);
const payMethodEnum = z.enum(['cash', 'upi', 'card', 'bank', 'cheque']);

/**
 * Payroll config on the employee master (§3.1). Every one of these arrives from
 * a dropdown or an optional field, so they are .optional().nullable() —
 * zod's .optional() alone REJECTS the null the frontend sends for "not set".
 */
const payrollConfigFields = {
  joiningDate: z.preprocess(emptyToNull, ymd.nullable().optional()),
  salaryType: z.preprocess(emptyToNull, salaryTypeEnum.nullable().optional()),
  monthlySalary: z.number().min(0).optional().nullable(),
  perDayRate: z.number().min(0).optional().nullable(),
  // 0 = Sunday … 6 = Saturday
  weeklyOffDay: z.number().int().min(0).max(6).optional().nullable(),
};

/** One employee-day in the attendance grid. */
const attendanceEntry = z.object({
  userId: z.number().int().positive(),
  status: attendanceStatusEnum,
  // Owner-discretionary, independent of status — a present day can carry ₹100.
  manualDeduction: z.number().min(0).optional().nullable(),
  note: z.preprocess(emptyToNull, z.string().max(500).nullable().optional()),
});

export const createEmployeeSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required').max(100),
    // Last name and email are NOT mandatory — many employees are just
    // salespeople tracked for commission who never log in.
    lastName: z.preprocess(emptyToNull, z.string().max(100).nullable().optional()),
    email: z.preprocess(emptyToNull, z.string().email('Invalid email').nullable().optional()),
    phone: z.string().max(20).optional().nullable(),
    role: roleEnum.default('staff'),
    branchId: z.number().int().positive().optional().nullable(),
    commissionRate: z.number().min(0).max(100).optional().nullable(),
    // Per-employee minimum daily-sales target (₹) for commission.
    commissionThreshold: z.number().min(0).optional().nullable(),
    // Password is mandatory at creation — whoever adds the employee sets it.
    password: z.string().min(6, 'Password must be at least 6 characters').max(100),
    ...payrollConfigFields,
  }),
});

export const updateEmployeeSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
  body: z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.preprocess(emptyToNull, z.string().max(100).nullable().optional()),
    email: z.preprocess(emptyToNull, z.string().email('Invalid email').nullable().optional()),
    phone: z.string().max(20).optional().nullable(),
    role: roleEnum.optional(),
    branchId: z.number().int().positive().optional().nullable(),
    commissionRate: z.number().min(0).max(100).optional().nullable(),
    commissionThreshold: z.number().min(0).optional().nullable(),
    isActive: z.boolean().optional(),
    // Optional on edit — blank means keep the current password.
    password: z.preprocess(emptyToNull, z.string().min(6, 'Password must be at least 6 characters').max(100).nullable().optional()),
    ...payrollConfigFields,
  }),
});

// ─── Attendance (§3.2) ───────────────────────────────

export const upsertAttendanceSchema = z.object({
  body: attendanceEntry.extend({ date: ymd }),
});

export const bulkAttendanceSchema = z.object({
  body: z.object({
    date: ymd,
    entries: z.array(attendanceEntry).min(1, 'At least one employee is required').max(500),
  }),
});

export const listAttendanceSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    userId: z.string().optional(),
    branchId: z.string().optional(),
    month: ym.optional(),
    status: attendanceStatusEnum.optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const attendanceSummarySchema = z.object({
  query: z.object({
    month: ym,
    branchId: z.string().optional(),
  }),
});

// ─── Payroll (§3.3) ──────────────────────────────────

export const payrollListSchema = z.object({
  query: z.object({
    month: ym,
    branchId: z.string().regex(/^\d+$/).optional(),
  }),
});

/** Route params are always strings. */
const payrollParams = z.object({
  userId: z.string().regex(/^\d+$/),
  month: ym,
});

export const payrollDetailSchema = z.object({ params: payrollParams });

export const finalisePayrollSchema = z.object({ params: payrollParams });

export const reopenPayrollSchema = z.object({ params: payrollParams });

export const payPayrollSchema = z.object({
  params: payrollParams,
  body: z.object({
    method: payMethodEnum,
    // 'YYYY-MM-DD' (IST calendar day) or a full ISO timestamp; defaults to now.
    paidAt: z.preprocess(emptyToNull, z.string().min(1).nullable().optional()),
    reference: z.preprocess(emptyToNull, z.string().max(120).nullable().optional()),
    notes: z.preprocess(emptyToNull, z.string().max(500).nullable().optional()),
  }),
});

export const listCommissionsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    userId: z.string().optional(),
    status: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const calculateCommissionsSchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});

export const payCommissionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/),
  }),
});

export const commissionSummarySchema = z.object({
  query: z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
    branchId: z.string().optional(),
  }),
});
