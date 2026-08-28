import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta, fullName } from '../../utils/helpers';
import { getSetting } from '../settings/service';
import {
  Ym,
  Ymd,
  dateOnly,
  dayOfWeek,
  istToday,
  isMonth,
  monthBounds,
  monthLabel,
  monthOf,
  toIstMonth,
  ymdOf,
} from '../../utils/ist';
import {
  AttendanceMark,
  AttendanceStatusValue,
  EmployeePayrollConfig,
  SalaryTypeValue,
  computeMonth,
  isPayrollConfigured,
  num,
  round2,
  weeklyOffMismatch,
} from './payroll';
import {
  pushCommissionPayable,
  pushSalaryPayable,
  settleSalaryPayable,
  voidSalaryPayable,
} from '../payables/autopush';

// ─── §6 auto-push seams ──────────────────────────────
// Payroll raises a Payable when a month is finalised, settles it when the month
// is paid (D6 — two steps), and voids it when the month is reopened. The
// implementations live in the payables module (`payables/autopush.ts`) so the
// payment maths has exactly one home; these are the seams payroll calls. Every
// one runs INSIDE the same $transaction as the SalaryPeriod write, so the
// payable and the period can never disagree.

/** The shape handed to {@link onSalaryPaid} — a payment intent, not a row. */
export interface SalaryPaymentIntent {
  amount: number;
  method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque';
  paidAt: Date;
  reference?: string | null;
  notes?: string | null;
  createdBy: number;
}

/** Raise the pending "Salary – <Name> – <Month>" payable, and link it back. */
export async function onSalaryFinalised(tx: any, salaryPeriod: any, createdBy: number) {
  return pushSalaryPayable(tx, salaryPeriod, createdBy);
}

/** Settle that payable with a PayablePayment (idempotent). */
export async function onSalaryPaid(
  tx: any,
  salaryPeriod: any,
  payment: SalaryPaymentIntent
) {
  return settleSalaryPayable(tx, salaryPeriod, payment);
}

/** Retire the accrual when a finalised month is reopened; 409 once paid. */
export async function onSalaryReopened(tx: any, salaryPeriod: any) {
  return voidSalaryPayable(tx, salaryPeriod);
}

/** Columns every payroll/attendance read needs off the employee. */
const PAYROLL_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  branchId: true,
  joiningDate: true,
  salaryType: true,
  monthlySalary: true,
  perDayRate: true,
  weeklyOffDay: true,
} as const;

/**
 * D3 — ONE payable per (employee, month), regardless of how the date range was
 * sliced. A range spanning a month boundary therefore yields two batches.
 */
function groupIntoMonthBatches(
  rows: Array<{ id: number; userId: number; amount: any; payPeriodStart: Date }>
) {
  const batches = new Map<
    string,
    { userId: number; month: Ym; ids: number[]; total: number }
  >();
  for (const c of rows) {
    const month = toIstMonth(c.payPeriodStart) as Ym;
    const key = `${c.userId}:${month}`;
    const batch = batches.get(key) ?? { userId: c.userId, month, ids: [], total: 0 };
    batch.ids.push(c.id);
    batch.total = round2(batch.total + num(c.amount));
    batches.set(key, batch);
  }
  return batches;
}

export class EmployeeService {
  // ─── Employee CRUD ─────────────────────────────────

  /**
   * POS and mobile POS both call this to populate the per-line salesman picker,
   * so a cashier must be able to read it. What a cashier must NOT read is what
   * everyone earns — pay configuration is returned only to owner/manager.
   */
  async list(
    query: { page?: string; limit?: string; search?: string; status?: string },
    viewerRole?: string
  ) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    // Active / inactive tab filter ('active' | 'inactive'; anything else = all).
    if (query.status === 'active') where.isActive = true;
    else if (query.status === 'inactive') where.isActive = false;

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          commissionRate: true,
          commissionThreshold: true,
          joiningDate: true,
          salaryType: true,
          monthlySalary: true,
          perDayRate: true,
          weeklyOffDay: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const canSeePay = viewerRole === 'owner' || viewerRole === 'manager';

    const data = employees.map((e) => {
      const row: any = { ...e, status: e.isActive ? 'active' : 'inactive' };
      if (!canSeePay) {
        delete row.commissionRate;
        delete row.commissionThreshold;
        delete row.salaryType;
        delete row.monthlySalary;
        delete row.perDayRate;
        delete row.joiningDate;
        delete row.weeklyOffDay;
      }
      return row;
    });

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }

  async create(body: {
    firstName: string;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    role: string;
    branchId?: number;
    commissionRate?: number;
    commissionThreshold?: number;
    password: string;
    // ─── Payroll config (§3.1) ───
    joiningDate?: string | null;
    salaryType?: SalaryTypeValue | null;
    monthlySalary?: number | null;
    perDayRate?: number | null;
    weeklyOffDay?: number | null;
  }) {
    // Email is optional; only enforce uniqueness when one is provided.
    if (body.email) {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw new AppError('Email already in use', 400);
    }

    // Password is set by whoever creates the account (no shared default).
    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await prisma.user.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName ?? null,
        email: body.email ?? null,
        phone: body.phone || null,
        role: body.role as any,
        branchId: body.branchId || 1,
        passwordHash,
        commissionRate: body.commissionRate ?? 0,
        commissionThreshold: body.commissionThreshold ?? 0,
        // joiningDate is a @db.Date — store UTC midnight of the IST day.
        joiningDate: body.joiningDate ? dateOnly(body.joiningDate) : null,
        salaryType: (body.salaryType ?? null) as any,
        monthlySalary: body.monthlySalary ?? null,
        perDayRate: body.perDayRate ?? null,
        weeklyOffDay: body.weeklyOffDay ?? null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        commissionRate: true,
        commissionThreshold: true,
        joiningDate: true,
        salaryType: true,
        monthlySalary: true,
        perDayRate: true,
        weeklyOffDay: true,
        isActive: true,
        branch: { select: { id: true, name: true } },
        createdAt: true,
      },
    });

    return user;
  }

  async update(
    id: number,
    body: {
      firstName?: string;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      role?: string;
      branchId?: number;
      commissionRate?: number;
      commissionThreshold?: number;
      isActive?: boolean;
      password?: string | null;
      joiningDate?: string | null;
      salaryType?: SalaryTypeValue | null;
      monthlySalary?: number | null;
      perDayRate?: number | null;
      weeklyOffDay?: number | null;
    }
  ) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('Employee not found', 404);

    if (body.email && body.email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw new AppError('Email already in use', 400);
    }

    const data: any = {};
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.email !== undefined) data.email = body.email;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.role !== undefined) data.role = body.role;
    if (body.branchId !== undefined) data.branchId = body.branchId;
    if (body.commissionRate !== undefined) data.commissionRate = body.commissionRate;
    if (body.commissionThreshold !== undefined) data.commissionThreshold = body.commissionThreshold;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    // ─── Payroll config. A later pay rise never rewrites a settled month:
    // finalised/paid SalaryPeriods carry their own snapshot (D10). ───
    if (body.joiningDate !== undefined) {
      data.joiningDate = body.joiningDate ? dateOnly(body.joiningDate) : null;
    }
    if (body.salaryType !== undefined) data.salaryType = body.salaryType;
    if (body.monthlySalary !== undefined) data.monthlySalary = body.monthlySalary;
    if (body.perDayRate !== undefined) data.perDayRate = body.perDayRate;
    if (body.weeklyOffDay !== undefined) data.weeklyOffDay = body.weeklyOffDay;
    // Only reset the password when a new one is supplied (blank = keep current).
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 12);

    return prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        commissionRate: true,
        commissionThreshold: true,
        joiningDate: true,
        salaryType: true,
        monthlySalary: true,
        perDayRate: true,
        weeklyOffDay: true,
        isActive: true,
        branch: { select: { id: true, name: true } },
        createdAt: true,
      },
    });
  }

  // ─── Attendance (status-based, spec §3.2) ───────────
  //
  // Clock-in / clock-out is GONE. A day is now a single status the owner or
  // manager marks — present / absent / half_day / late / paid_weekly_off —
  // optionally carrying a manual deduction. The old clockIn/clockOut/hoursWorked
  // columns survive only as nullable legacy data.

  private async requireEmployee(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: PAYROLL_USER_SELECT,
    });
    if (!user) throw new AppError('Employee not found', 404);
    return user;
  }

  private employeeConfig(user: {
    salaryType: any;
    monthlySalary: any;
    perDayRate: any;
    joiningDate: Date | null;
    weeklyOffDay: number | null;
  }): EmployeePayrollConfig {
    return {
      salaryType: (user.salaryType ?? null) as SalaryTypeValue | null,
      monthlySalary: user.monthlySalary as any,
      perDayRate: user.perDayRate as any,
      joiningDate: user.joiningDate ? ymdOf(user.joiningDate) : null,
      weeklyOffDay: user.weeklyOffDay ?? null,
    };
  }

  /**
   * A finalised or paid month is frozen — its rates and counts are already
   * snapshotted onto the SalaryPeriod (D10), so letting attendance move would
   * make the payslip lie. Reopen the month first.
   */
  private async assertMonthEditable(userId: number, month: Ym) {
    const period = await prisma.salaryPeriod.findUnique({
      where: { userId_month: { userId, month } },
      select: { status: true },
    });
    if (period && period.status !== 'open') {
      throw new AppError(
        `Salary for ${monthLabel(month)} is ${period.status} — reopen the month before changing attendance`,
        409
      );
    }
  }

  /** D9 — nothing before the joining date is markable. */
  private assertOnOrAfterJoining(
    user: { firstName: string; lastName: string | null; joiningDate: Date | null },
    date: Ymd
  ) {
    if (!user.joiningDate) return;
    const joining = ymdOf(user.joiningDate);
    if (date < joining) {
      throw new AppError(
        `${fullName(user)} joined on ${joining} — ${date} is before their joining date`,
        400
      );
    }
  }

  /**
   * Upsert one employee-day. Keyed on the existing @@unique([userId, date]),
   * so re-marking a day overwrites it rather than piling up rows.
   */
  async upsertAttendance(
    body: {
      userId: number;
      date: Ymd;
      status: AttendanceStatusValue;
      manualDeduction?: number | null;
      note?: string | null;
    },
    actor: { userId: number; branchId: number }
  ) {
    const user = await this.requireEmployee(body.userId);
    this.assertOnOrAfterJoining(user, body.date);
    await this.assertMonthEditable(body.userId, monthOf(body.date));

    const warnings: string[] = [];
    // Shops swap the weekly off around; allowed, but say so out loud.
    if (weeklyOffMismatch(body.date, body.status, user.weeklyOffDay)) {
      warnings.push(
        `${body.date} is not ${fullName(user)}'s usual weekly off — marked as a paid weekly off anyway`
      );
    }

    const values = {
      status: body.status as any,
      manualDeduction: body.manualDeduction ?? 0,
      note: body.note ?? null,
      markedBy: actor.userId,
    };

    const attendance = await prisma.attendance.upsert({
      where: { userId_date: { userId: body.userId, date: dateOnly(body.date) } },
      create: {
        userId: body.userId,
        branchId: user.branchId ?? actor.branchId,
        date: dateOnly(body.date),
        ...values,
      },
      update: values,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    return { attendance, warnings };
  }

  /**
   * One day, many employees — the attendance grid's "mark the whole shop" save.
   * Every entry is validated BEFORE anything is written, so a bad row can't
   * leave the day half-marked.
   */
  async bulkUpsertAttendance(
    body: {
      date: Ymd;
      entries: Array<{
        userId: number;
        status: AttendanceStatusValue;
        manualDeduction?: number | null;
        note?: string | null;
      }>;
    },
    actor: { userId: number; branchId: number }
  ) {
    const month = monthOf(body.date);
    const userIds = [...new Set(body.entries.map((e) => e.userId))];

    const users =
      (await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: PAYROLL_USER_SELECT,
      })) ?? [];
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    const missing = userIds.filter((id) => !userMap.has(id));
    if (missing.length) {
      throw new AppError(`Employee not found: ${missing.join(', ')}`, 404);
    }

    const frozen =
      (await prisma.salaryPeriod.findMany({
        where: { month, userId: { in: userIds }, status: { not: 'open' } },
        select: { userId: true, status: true },
      })) ?? [];
    if (frozen.length) {
      const names = frozen
        .map((p: any) => fullName(userMap.get(p.userId) ?? { firstName: `#${p.userId}` }))
        .join(', ');
      throw new AppError(
        `Salary for ${monthLabel(month)} is already closed for ${names} — reopen the month first`,
        409
      );
    }

    const warnings: string[] = [];
    for (const entry of body.entries) {
      const user = userMap.get(entry.userId)!;
      this.assertOnOrAfterJoining(user, body.date);
      if (weeklyOffMismatch(body.date, entry.status, user.weeklyOffDay)) {
        warnings.push(
          `${body.date} is not ${fullName(user)}'s usual weekly off — marked as a paid weekly off anyway`
        );
      }
    }

    const date = dateOnly(body.date);
    const saved = await prisma.$transaction(async (tx: any) => {
      const out: any[] = [];
      for (const entry of body.entries) {
        const user = userMap.get(entry.userId)!;
        const values = {
          status: entry.status as any,
          manualDeduction: entry.manualDeduction ?? 0,
          note: entry.note ?? null,
          markedBy: actor.userId,
        };
        out.push(
          await tx.attendance.upsert({
            where: { userId_date: { userId: entry.userId, date } },
            create: {
              userId: entry.userId,
              branchId: user.branchId ?? actor.branchId,
              date,
              ...values,
            },
            update: values,
          })
        );
      }
      return out;
    });

    return { date: body.date, marked: body.entries.length, attendance: saved, warnings };
  }

  async listAttendance(query: {
    page?: string;
    limit?: string;
    userId?: string;
    branchId?: string;
    month?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.userId) where.userId = parseInt(query.userId);
    if (query.branchId) where.branchId = parseInt(query.branchId);
    if (query.status) where.status = query.status;

    // `month` is the primary filter now (the grid is a month at a time);
    // startDate/endDate stay for ad-hoc ranges.
    if (query.month && isMonth(query.month)) {
      const { start, end } = monthBounds(query.month);
      where.date = { gte: start, lt: end };
    } else if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = dateOnly(query.startDate);
      // Inclusive of the end day: @db.Date values are exactly UTC midnight.
      if (query.endDate) where.date.lte = dateOnly(query.endDate);
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { userId: 'asc' }],
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          branch: { select: { id: true, name: true } },
          marker: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.attendance.count({ where }),
    ]);

    return { data: records, meta: buildPaginationMeta(page, limit, total) };
  }

  /**
   * Per-employee status counts for a month — replaces the old hours-worked
   * roll-up. `unmarkedDays` is NOT computed here (it needs each employee's
   * joining date and the elapsed-days rule); use GET /payroll for that.
   */
  async getAttendanceSummary(query: { month: string; branchId?: string }) {
    const { start, end } = monthBounds(query.month as Ym);

    const where: any = { date: { gte: start, lt: end } };
    if (query.branchId) where.branchId = parseInt(query.branchId);

    const grouped =
      (await prisma.attendance.groupBy({
        by: ['userId', 'status'],
        where,
        _count: { id: true },
        _sum: { manualDeduction: true },
      })) ?? [];

    const userIds = [...new Set(grouped.map((g: any) => g.userId))];
    const users =
      (await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: PAYROLL_USER_SELECT,
      })) ?? [];
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    const rows = new Map<number, any>();
    for (const g of grouped as any[]) {
      let row = rows.get(g.userId);
      if (!row) {
        const u = userMap.get(g.userId);
        row = {
          userId: g.userId,
          user: u ? { id: u.id, firstName: u.firstName, lastName: u.lastName } : undefined,
          name: u ? fullName(u) : '',
          presentDays: 0,
          absentDays: 0,
          halfDays: 0,
          lateDays: 0,
          paidOffDays: 0,
          daysMarked: 0,
          manualDeductionTotal: 0,
        };
        rows.set(g.userId, row);
      }
      const count = g._count?.id ?? 0;
      row.daysMarked += count;
      row.manualDeductionTotal += num(g._sum?.manualDeduction);
      switch (g.status) {
        case 'present':
          row.presentDays += count;
          break;
        case 'absent':
          row.absentDays += count;
          break;
        case 'half_day':
          row.halfDays += count;
          break;
        case 'late':
          row.lateDays += count;
          break;
        case 'paid_weekly_off':
          row.paidOffDays += count;
          break;
      }
    }

    const summary = [...rows.values()].map((r) => ({
      ...r,
      manualDeductionTotal: Math.round(r.manualDeductionTotal * 100) / 100,
    }));

    return { month: query.month, summary };
  }

  // ─── Payroll (spec §3.3 / §3.4) ─────────────────────

  /** Read a month's attendance for one employee and price it. */
  private async computeEmployeeMonth(user: any, month: Ym, today?: Ymd) {
    const { start, end } = monthBounds(month);
    const rows =
      (await prisma.attendance.findMany({
        where: { userId: user.id, date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
        include: { marker: { select: { id: true, firstName: true, lastName: true } } },
      })) ?? [];

    const marks: AttendanceMark[] = rows.map((r: any) => ({
      date: ymdOf(r.date),
      status: r.status as AttendanceStatusValue,
      manualDeduction: r.manualDeduction,
    }));

    return {
      rows,
      marks,
      computed: computeMonth(month, this.employeeConfig(user), marks, today),
    };
  }

  /** Snapshotted figures win once a month is finalised or paid (D10). */
  private snapshotView(period: any) {
    const earnedDays =
      period.salaryType === 'daily_wage'
        ? period.presentDays + period.lateDays + period.halfDays * 0.5 + period.paidOffDays
        : 0;
    const manualDeductionTotal = num(period.manualDeductionTotal);
    const grossAmount =
      period.salaryType === 'daily_wage'
        ? round2(earnedDays * num(period.perDayRate))
        : round2(num(period.baseAmount) - num(period.attendanceDeduction));

    return {
      counts: {
        presentDays: period.presentDays,
        absentDays: period.absentDays,
        halfDays: period.halfDays,
        lateDays: period.lateDays,
        paidOffDays: period.paidOffDays,
        unmarkedDays: period.unmarkedDays,
      },
      breakdown: {
        salaryType: period.salaryType,
        baseAmount: num(period.baseAmount),
        perDayRate: num(period.perDayRate),
        earnedDays,
        // Reconstructed exactly as computeSalary derives it, NOT as
        // net + manual: net is clamped at 0 (D8), so on a month where the
        // deductions exceeded the pay, deriving gross from net would overstate
        // it by the clamped amount.
        grossAmount,
        attendanceDeduction: num(period.attendanceDeduction),
        manualDeductionTotal: num(period.manualDeductionTotal),
        netAmount: num(period.netAmount),
        unrecoveredExcess:
          manualDeductionTotal > grossAmount
            ? round2(manualDeductionTotal - grossAmount)
            : 0,
      },
    };
  }

  /**
   * GET /payroll — everyone who has to be paid for this month.
   *
   * Not just the currently-active staff: someone deactivated on the 20th still
   * earned twenty days, and dropping them from the list would silently omit a
   * salary the shop owes. Anyone with attendance in the month, or an existing
   * salary period for it, is included regardless of `isActive`.
   */
  async getPayrollMonth(query: { month: string; branchId?: string }, actor: { branchId: number }) {
    const month = query.month as Ym;
    const branchId = query.branchId ? parseInt(query.branchId) : actor.branchId;
    const today = istToday();

    const { start, end } = monthBounds(month);

    // Leavers: anyone who was marked present, or already has a salary period,
    // in this month still belongs on the list.
    const [markedInMonth, periodsInMonth] = await Promise.all([
      prisma.attendance.findMany({
        where: { branchId, date: { gte: start, lt: end } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.salaryPeriod.findMany({
        where: { branchId, month },
        select: { userId: true },
      }),
    ]);
    const carriedOver = [
      ...new Set([
        ...(markedInMonth ?? []).map((a: any) => a.userId),
        ...(periodsInMonth ?? []).map((p: any) => p.userId),
      ]),
    ];

    const users =
      (await prisma.user.findMany({
        where: {
          branchId,
          OR: [{ isActive: true }, { id: { in: carriedOver.length ? carriedOver : [-1] } }],
        },
        select: PAYROLL_USER_SELECT,
        orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
      })) ?? [];

    const ids = users.map((u: any) => u.id);

    const [attendance, periods] = await Promise.all([
      prisma.attendance.findMany({
        where: { userId: { in: ids }, date: { gte: start, lt: end } },
        select: { userId: true, date: true, status: true, manualDeduction: true },
      }),
      prisma.salaryPeriod.findMany({ where: { month, userId: { in: ids } } }),
    ]);

    const marksByUser = new Map<number, AttendanceMark[]>();
    for (const r of (attendance ?? []) as any[]) {
      const list = marksByUser.get(r.userId) ?? [];
      list.push({
        date: ymdOf(r.date),
        status: r.status as AttendanceStatusValue,
        manualDeduction: r.manualDeduction,
      });
      marksByUser.set(r.userId, list);
    }
    const periodByUser = new Map<number, any>(
      ((periods ?? []) as any[]).map((p) => [p.userId, p])
    );

    const rows = users.map((u: any) => {
      const config = this.employeeConfig(u);
      const live = computeMonth(month, config, marksByUser.get(u.id) ?? [], today);
      const period = periodByUser.get(u.id);
      const settled = period && period.status !== 'open';
      const view = settled ? this.snapshotView(period) : { counts: live.counts, breakdown: live.breakdown };

      return {
        userId: u.id,
        name: fullName(u),
        role: u.role,
        branchId: u.branchId,
        joiningDate: config.joiningDate,
        weeklyOffDay: u.weeklyOffDay,
        configured: isPayrollConfigured(config),
        counts: view.counts,
        ...view.breakdown,
        // Rates come from the SNAPSHOT once the month is settled (D10) and from
        // the live employee record while it is still open.
        salaryType: settled ? period.salaryType : u.salaryType ?? null,
        monthlySalary: settled ? num(period.baseAmount) : u.monthlySalary,
        perDayRate: settled ? num(period.perDayRate) : u.perDayRate,
        // D2 — surfaced so the owner sees "N days unmarked" before paying.
        unmarkedDays: view.counts.unmarkedDays,
        status: period?.status ?? 'open',
        salaryPeriodId: period?.id ?? null,
        payableId: period?.payableId ?? null,
        finalisedAt: period?.finalisedAt ?? null,
        paidAt: period?.paidAt ?? null,
      };
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totals = {
      employees: rows.length,
      net: round2(rows.reduce((s, r) => s + num(r.netAmount), 0)),
      pending: round2(
        rows.filter((r) => r.status !== 'paid').reduce((s, r) => s + num(r.netAmount), 0)
      ),
      paid: round2(
        rows.filter((r) => r.status === 'paid').reduce((s, r) => s + num(r.netAmount), 0)
      ),
      unmarkedDays: rows.reduce((s, r) => s + (r.unmarkedDays ?? 0), 0),
    };

    return { month, branchId, rows, totals };
  }

  /** GET /payroll/:userId/:month — the day-by-day grid plus the breakdown. */
  async getPayrollDetail(userId: number, month: Ym) {
    const user = await this.requireEmployee(userId);
    const config = this.employeeConfig(user);
    const today = istToday();
    const { rows, computed } = await this.computeEmployeeMonth(user, month, today);

    const period = await prisma.salaryPeriod.findUnique({
      where: { userId_month: { userId, month } },
    });
    const settled = period && period.status !== 'open';
    const view = settled
      ? this.snapshotView(period)
      : { counts: computed.counts, breakdown: computed.breakdown };

    const byDate = new Map<string, any>(rows.map((r: any) => [ymdOf(r.date), r]));
    const days = computed.days.map((date) => {
      const row = byDate.get(date);
      const beforeJoining = !!config.joiningDate && date < config.joiningDate;
      const dow = dayOfWeek(date);
      return {
        date,
        dayOfWeek: dow,
        isWeeklyOff: config.weeklyOffDay !== null && config.weeklyOffDay === dow,
        beforeJoining,
        isFuture: date > today,
        // D9 — pre-joining days are never markable; a closed month is frozen.
        editable: !beforeJoining && !settled,
        status: row?.status ?? null,
        manualDeduction: row ? num(row.manualDeduction) : 0,
        note: row?.note ?? null,
        markedBy: row?.markedBy ?? null,
        marker: row?.marker ?? null,
      };
    });

    return {
      month,
      employee: {
        id: user.id,
        name: fullName(user),
        role: user.role,
        branchId: user.branchId,
        joiningDate: config.joiningDate,
        salaryType: user.salaryType,
        monthlySalary: user.monthlySalary,
        perDayRate: user.perDayRate,
        weeklyOffDay: user.weeklyOffDay,
        configured: isPayrollConfigured(config),
      },
      days,
      counts: view.counts,
      ...view.breakdown,
      preJoiningDays: computed.preJoiningDays,
      futureDays: computed.futureDays,
      status: period?.status ?? 'open',
      salaryPeriodId: period?.id ?? null,
      payableId: period?.payableId ?? null,
      finalisedAt: period?.finalisedAt ?? null,
      paidAt: period?.paidAt ?? null,
    };
  }

  /**
   * POST /payroll/:userId/:month/finalise — snapshot the rates and counts onto
   * the SalaryPeriod (D10) and raise the pending payable (D6, step 1).
   */
  async finalisePayroll(userId: number, month: Ym, actor: { userId: number; branchId: number }) {
    const user = await this.requireEmployee(userId);
    const config = this.employeeConfig(user);

    if (!isPayrollConfigured(config)) {
      throw new AppError(
        `Salary is not configured for ${fullName(user)} — set a salary type, a per-day rate` +
          (config.salaryType === 'fixed_monthly' ? ' and a monthly salary' : '') +
          ' before finalising',
        400
      );
    }

    const existing = await prisma.salaryPeriod.findUnique({
      where: { userId_month: { userId, month } },
    });
    if (existing && existing.status === 'paid') {
      throw new AppError(`Salary for ${monthLabel(month)} is already paid`, 409);
    }
    if (existing && existing.status === 'finalised') {
      throw new AppError(
        `Salary for ${monthLabel(month)} is already finalised — reopen it to recalculate`,
        409
      );
    }

    const { computed } = await this.computeEmployeeMonth(user, month);
    const b = computed.breakdown;
    const c = computed.counts;

    const data = {
      branchId: user.branchId ?? actor.branchId,
      salaryType: b.salaryType as any,
      baseAmount: b.baseAmount,
      perDayRate: b.perDayRate,
      presentDays: c.presentDays,
      absentDays: c.absentDays,
      halfDays: c.halfDays,
      lateDays: c.lateDays,
      paidOffDays: c.paidOffDays,
      unmarkedDays: c.unmarkedDays,
      manualDeductionTotal: b.manualDeductionTotal,
      attendanceDeduction: b.attendanceDeduction,
      netAmount: b.netAmount,
      status: 'finalised' as any,
      finalisedAt: new Date(),
    };

    const period = await prisma.$transaction(async (tx: any) => {
      const saved = await tx.salaryPeriod.upsert({
        where: { userId_month: { userId, month } },
        create: { userId, month, ...data },
        update: data,
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      // D6 — finalising only ACCRUES the salary; the Paid action settles it.
      const payable = await onSalaryFinalised(tx, saved, actor.userId);
      return { ...saved, payableId: payable?.id ?? saved.payableId ?? null };
    });

    return {
      ...period,
      // D8 — reported, never carried into the next month.
      unrecoveredExcess: b.unrecoveredExcess,
      grossAmount: b.grossAmount,
      earnedDays: b.earnedDays,
    };
  }

  /** POST /payroll/:userId/:month/pay — settle the finalised month (D6, step 2). */
  async payPayroll(
    userId: number,
    month: Ym,
    body: {
      method: SalaryPaymentIntent['method'];
      paidAt?: string | null;
      reference?: string | null;
      notes?: string | null;
    },
    actor: { userId: number }
  ) {
    const period = await prisma.salaryPeriod.findUnique({
      where: { userId_month: { userId, month } },
    });
    if (!period) {
      throw new AppError(`Salary for ${monthLabel(month)} has not been finalised yet`, 404);
    }
    if (period.status === 'paid') {
      throw new AppError(`Salary for ${monthLabel(month)} is already paid`, 409);
    }
    if (period.status !== 'finalised') {
      throw new AppError(
        `Finalise ${monthLabel(month)} before paying it`,
        409
      );
    }

    const paidAt = body.paidAt
      ? body.paidAt.includes('T')
        ? new Date(body.paidAt)
        : dateOnly(body.paidAt)
      : new Date();

    const payment: SalaryPaymentIntent = {
      amount: num(period.netAmount),
      method: body.method,
      paidAt,
      reference: body.reference ?? null,
      notes: body.notes ?? null,
      createdBy: actor.userId,
    };

    return prisma.$transaction(async (tx: any) => {
      const saved = await tx.salaryPeriod.update({
        where: { id: period.id },
        data: { status: 'paid' as any, paidAt, paidBy: actor.userId },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      await onSalaryPaid(tx, saved, payment);
      return saved;
    });
  }

  /** POST /payroll/:userId/:month/reopen — owner only. */
  async reopenPayroll(userId: number, month: Ym) {
    const period = await prisma.salaryPeriod.findUnique({
      where: { userId_month: { userId, month } },
    });
    if (!period) {
      throw new AppError(`No salary period for ${monthLabel(month)}`, 404);
    }
    if (period.status === 'paid') {
      throw new AppError(
        `Salary for ${monthLabel(month)} is already paid — reverse the payment before reopening`,
        409
      );
    }
    if (period.status === 'open') return period;

    // §6 — the accrual raised at finalise is voided in the SAME transaction as
    // the reopen, so a reopened month can never leave a live salary payable
    // behind. Refuses (409) if money has already moved against it.
    return prisma.$transaction(async (tx: any) => {
      await onSalaryReopened(tx, period);
      return tx.salaryPeriod.update({
        where: { id: period.id },
        data: { status: 'open' as any, finalisedAt: null, payableId: null },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
    });
  }

  // ─── Commissions ────────────────────────────────────


  /**
   * Build a Prisma `sale` relation filter that matches by the bill date
   * (`sale.businessDate ?? sale.createdAt`) for a [startDate, endDate] range.
   * businessDate is a @db.Date (day only); createdAt is the timestamp fallback
   * used only for the rare sale with no businessDate. Returns undefined when no
   * range is given.
   */
  private billDateSaleFilter(startDate?: string, endDate?: string): any | undefined {
    if (!startDate && !endDate) return undefined;
    const dateRange: any = {}; // sale.businessDate (date)
    const tsRange: any = {}; // sale.createdAt (timestamp) fallback
    if (startDate) {
      const s = new Date(startDate);
      dateRange.gte = s;
      tsRange.gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      dateRange.lte = e;
      const eEnd = new Date(e);
      eEnd.setHours(23, 59, 59, 999); // include the whole end day for timestamps
      tsRange.lte = eEnd;
    }
    return {
      OR: [{ businessDate: dateRange }, { businessDate: null, createdAt: tsRange }],
    };
  }

  async listCommissions(query: {
    page?: string;
    limit?: string;
    userId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.userId) where.userId = parseInt(query.userId);
    if (query.status) where.status = query.status;
    // Date range filters by the BILL date (sale.businessDate ?? sale.createdAt),
    // matching the Date column — not payPeriodStart (the calc-run window).
    const saleDate = this.billDateSaleFilter(query.startDate, query.endDate);
    if (saleDate) where.sale = saleDate;

    const [commissions, total, totalsAgg] = await Promise.all([
      prisma.commission.findMany({
        where,
        skip,
        take: limit,
        // Sort by bill date (desc). businessDate is the trading day; sale.createdAt
        // orders bills within a day; commission.createdAt is a final tiebreaker.
        orderBy: [
          { sale: { businessDate: 'desc' } },
          { sale: { createdAt: 'desc' } },
          { createdAt: 'desc' },
        ],
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          // businessDate/createdAt = the actual bill date, shown in the table.
          // (commission.createdAt is just when the calc run inserted the row.)
          sale: { select: { id: true, saleNumber: true, total: true, businessDate: true, createdAt: true } },
        },
      }),
      prisma.commission.count({ where }),
      // Money KPIs must cover the WHOLE filtered set, not just the current page —
      // otherwise the cards (page subtotal) disagree with the statement/record count.
      prisma.commission.groupBy({ by: ['status'], where, _sum: { amount: true } }),
    ]);

    let totalAmount = 0;
    let pendingAmount = 0;
    let paidAmount = 0;
    for (const g of totalsAgg) {
      const amt = Number(g._sum.amount || 0);
      totalAmount += amt;
      if (g.status === 'paid') paidAmount += amt;
      else if (g.status === 'pending') pendingAmount += amt;
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      data: commissions,
      meta: {
        ...buildPaginationMeta(page, limit, total),
        totals: {
          total: round2(totalAmount),
          pending: round2(pendingAmount),
          paid: round2(paidAmount),
        },
      },
    };
  }

  /**
   * Calculate commissions for a date range.
   *
   * Reads the global `commissionMode` setting:
   *
   * - **item_level** (default): groups SaleItems by agentId, computes
   *   commission on each agent's line totals × their commissionRate.
   *   One sale can generate multiple Commission rows (one per agent).
   *
   * - **bill_level**: one Commission row per sale for the cashier
   *   (sale.userId) based on sale.total × cashier.commissionRate.
   */
  async calculateCommissions(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
  }) {
    const mode = await getSetting<string>('commissionMode', 'item_level');

    // Fetch every real sale whose BILL date (businessDate ?? createdAt) is in
    // range, so each business day is COMPLETE and the daily threshold is measured
    // against the whole day. Commission is paid on GROSS sold value — the
    // salesperson did their part at the point of sale, so returns/exchanges never
    // reduce it. Hence we include returned + partially-returned sales too (their
    // original sold value still earns).
    const salesWhere: any = {
      ...this.billDateSaleFilter(query.startDate, query.endDate),
      status: { in: ['completed', 'partially_returned', 'returned'] },
    };
    if (query.branchId) salesWhere.branchId = parseInt(query.branchId);

    const sales = await prisma.sale.findMany({
      where: salesWhere,
      include: {
        user: { select: { id: true, commissionRate: true, commissionThreshold: true } },
        items: {
          include: {
            agent: { select: { id: true, commissionRate: true, commissionThreshold: true } },
          },
        },
      },
    });

    // saleId -> business day (YYYY-MM-DD)
    const dayOf = new Map<number, string>();
    for (const s of sales) dayOf.set(s.id, (s.businessDate ?? s.createdAt).toISOString().slice(0, 10));

    // §commission — minimum DAILY-sales target, now PER-EMPLOYEE (each employee's
    // `commissionThreshold`). Commission is earned only on the portion of that
    // employee's own daily sales ABOVE their target. 0 = off for that employee
    // (every rupee earns commission). There is no store-wide threshold.
    const userThreshold = new Map<number, number>();

    // First collect every (employee, sale) commission base, tagged with the
    // trading day, WITHOUT applying the rate yet — we need each employee's full
    // daily total before we know how much of it clears the threshold.
    type Entry = { userId: number; saleId: number; base: number; rate: number; day: string };
    const entries: Entry[] = [];

    for (const sale of sales) {
      const day = dayOf.get(sale.id)!;

      if (mode === 'bill_level') {
        // ── Bill-level: commission on the whole sale for the cashier ──
        // GROSS: returns don't reduce it (the cashier rang up the sale).
        const rate = Number(sale.user.commissionRate);
        if (rate <= 0) continue;
        const grossTotal = Number(sale.total);
        if (grossTotal <= 0) continue;
        userThreshold.set(sale.userId, Number(sale.user.commissionThreshold) || 0);
        entries.push({ userId: sale.userId, saleId: sale.id, base: grossTotal, rate, day });
      } else {
        // ── Item-level: commission per agent per line item ──
        // GROSS: the full sold line value, NOT netted for returns — the agent
        // sold it; a later return/exchange is not their problem.
        const agentTotals = new Map<number, number>();
        for (const item of sale.items) {
          if (!item.agentId || !item.agent) continue;
          const grossLine = Number(item.total);
          if (grossLine <= 0) continue;
          agentTotals.set(item.agentId, (agentTotals.get(item.agentId) ?? 0) + grossLine);
        }
        for (const [agentId, lineTotal] of agentTotals) {
          const agent = sale.items.find((i) => i.agentId === agentId)?.agent;
          if (!agent) continue;
          const rate = Number(agent.commissionRate);
          if (rate <= 0) continue;
          userThreshold.set(agentId, Number(agent.commissionThreshold) || 0);
          entries.push({ userId: agentId, saleId: sale.id, base: lineTotal, rate, day });
        }
      }
    }

    // Sum each employee's sales per trading day → how much clears the threshold.
    const dailyBase = new Map<string, number>();
    for (const e of entries) {
      const k = `${e.userId}|${e.day}`;
      dailyBase.set(k, (dailyBase.get(k) ?? 0) + e.base);
    }

    // Existing commissions for these sales. A (employee, business-day) group that
    // already has a PAID row is LOCKED — never touched (recomputing would change a
    // settled payout). Every other group is recomputed: stale PENDING rows are
    // deleted and replaced, so re-running is safe/idempotent.
    const scopeSaleIds = sales.map((s) => s.id);
    const existing = scopeSaleIds.length
      ? await prisma.commission.findMany({
          where: { saleId: { in: scopeSaleIds } },
          select: { id: true, saleId: true, userId: true, status: true },
        })
      : [];

    const lockedGroups = new Set<string>();
    for (const c of existing) {
      if (c.status === 'paid') {
        const day = dayOf.get(c.saleId);
        if (day) lockedGroups.add(`${c.userId}|${day}`);
      }
    }

    const pendingIdsToDelete: number[] = [];
    for (const c of existing) {
      if (c.status === 'paid') continue;
      const day = dayOf.get(c.saleId);
      if (day && !lockedGroups.has(`${c.userId}|${day}`)) pendingIdsToDelete.push(c.id);
    }

    const newCommissions: Array<{
      userId: number;
      saleId: number;
      amount: number;
      rate: number;
      payPeriodStart: Date;
      payPeriodEnd: Date;
    }> = [];
    let lockedSkipped = 0;

    for (const e of entries) {
      const group = `${e.userId}|${e.day}`;
      if (lockedGroups.has(group)) {
        lockedSkipped++;
        continue;
      }
      const base = dailyBase.get(group) ?? 0;
      const threshold = userThreshold.get(e.userId) ?? 0;
      // Only the employee's OWN daily sales ABOVE their threshold earn commission;
      // spread that across the day's bills in proportion to each bill's base.
      const factor = base > 0 ? Math.max(0, base - threshold) / base : 0;
      const amount = Math.round(e.base * factor * (e.rate / 100) * 100) / 100;
      if (amount <= 0) continue; // whole day below the threshold → no commission
      const day = new Date(e.day); // payPeriod = the business day this bill belongs to
      newCommissions.push({
        userId: e.userId,
        saleId: e.saleId,
        amount,
        rate: e.rate,
        payPeriodStart: day,
        payPeriodEnd: day,
      });
    }

    await prisma.$transaction([
      ...(pendingIdsToDelete.length
        ? [prisma.commission.deleteMany({ where: { id: { in: pendingIdsToDelete } } })]
        : []),
      ...(newCommissions.length
        ? [prisma.commission.createMany({ data: newCommissions })]
        : []),
    ]);

    return {
      mode,
      created: newCommissions.length,
      deleted: pendingIdsToDelete.length,
      skipped: lockedSkipped, // left untouched because the day has a paid payout
      period: { startDate: query.startDate, endDate: query.endDate },
    };
  }

  /**
   * D3 — paying a commission stamps the settlement metadata AND pushes the
   * "Commission – <Name> – <Month>" payable, so commission money appears in
   * the same ledger salary does. The month comes from the commission's own
   * pay period, not from today.
   *
   * `actor` is optional so the existing controller keeps compiling; pass it and
   * the payable is attributed to the person who clicked Pay.
   */
  async payCommission(id: number, actor?: { userId: number; branchId?: number }) {
    const commission = await prisma.commission.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, branchId: true } },
      },
    });
    if (!commission) {
      throw new AppError('Commission not found', 404);
    }

    if (commission.status === 'paid') {
      throw new AppError('Commission is already paid', 400);
    }

    const month = toIstMonth(commission.payPeriodStart) as Ym;
    const branchId = commission.user?.branchId ?? actor?.branchId ?? null;
    const paidAt = new Date();

    return prisma.$transaction(async (tx: any) => {
      // CLAIM FIRST, then push. The status check above is outside the
      // transaction, so two concurrent clicks would both reach here; the
      // `status: 'pending'` precondition means only one of them claims the row.
      // Pushing the payable before claiming would add the amount twice.
      const claim = await tx.commission.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'paid', paidAt, paidBy: actor?.userId ?? null },
      });
      if (!claim || claim.count === 0) {
        throw new AppError('Commission is already paid', 409);
      }

      // branchId is non-null in the schema; the guard only stops a payout being
      // blocked by a half-populated row.
      const payable =
        branchId == null
          ? null
          : await pushCommissionPayable(tx, {
              userId: commission.userId,
              month,
              amount: num(commission.amount),
              branchId,
              name: fullName(commission.user ?? { firstName: `Employee #${commission.userId}` }),
              createdBy: actor?.userId ?? commission.userId,
            });

      return tx.commission.update({
        where: { id },
        data: { payableId: payable?.id ?? null },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          sale: { select: { id: true, saleNumber: true, total: true, businessDate: true, createdAt: true } },
        },
      });
    });
  }

  /**
   * Mark all pending commissions in a date range as paid. Optionally filter by employee.
   */
  async payCommissionsBulk(
    query: {
      startDate: string;
      endDate: string;
      userId?: number;
    },
    actor?: { userId: number; branchId?: number }
  ) {
    // Match by the BILL date (sale.businessDate ?? sale.createdAt), same as the
    // list — so "pay 01–05 Aug" pays commissions for bills from those days, not
    // whenever the calc run happened to insert the rows.
    const where: any = {
      status: 'pending',
      sale: this.billDateSaleFilter(query.startDate, query.endDate),
    };
    if (query.userId) where.userId = query.userId;

    // updateMany can't filter on a relation, so resolve the rows first. This
    // read is repeated INSIDE the transaction below — a read out here could go
    // stale between the two, and paying on stale rows doubles the payable.
    const preview =
      (await prisma.commission.findMany({
        where,
        select: { id: true },
      })) || [];
    if (preview.length === 0) return { paidCount: 0, payables: [] as any[] };

    const paidAt = new Date();

    return prisma.$transaction(async (tx: any) => {
      // Re-read inside the transaction so the rows we group are the rows we
      // claim. A concurrent "pay bulk" that got here first will already have
      // flipped them out of `pending`.
      const rows =
        (await tx.commission.findMany({
          where,
          select: { id: true, userId: true, amount: true, payPeriodStart: true },
        })) || [];
      if (rows.length === 0) return { paidCount: 0, payables: [] as any[] };

      const batches = groupIntoMonthBatches(rows);

      const employees =
        (await tx.user.findMany({
          where: { id: { in: [...new Set(rows.map((c: any) => c.userId))] } },
          select: { id: true, firstName: true, lastName: true, branchId: true },
        })) || [];
      const byId = new Map<number, any>(employees.map((u: any) => [u.id, u]));

      let paidCount = 0;
      const payables: any[] = [];

      for (const batch of batches.values()) {
        // CLAIM the rows before pushing the payable. `status: 'pending'` is the
        // precondition that makes a double-click a no-op instead of doubling
        // what the shop owes: the second caller claims 0 rows and skips.
        const claimed = await tx.commission.updateMany({
          where: { id: { in: batch.ids }, status: 'pending' },
          data: { status: 'paid', paidAt, paidBy: actor?.userId ?? null },
        });
        const claimedCount =
          typeof claimed?.count === 'number' ? claimed.count : batch.ids.length;
        if (claimedCount === 0) continue;

        // Bill the payable for what we ACTUALLY claimed, not for what the read
        // saw. `paidAt` identifies this call's rows precisely.
        const settled =
          (await tx.commission.findMany({
            where: { id: { in: batch.ids }, status: 'paid', paidAt },
            select: { id: true, amount: true },
          })) || [];
        const settledIds = settled.length ? settled.map((c: any) => c.id) : batch.ids;
        const settledTotal = settled.length
          ? round2(settled.reduce((sum: number, c: any) => sum + num(c.amount), 0))
          : batch.total;

        const employee = byId.get(batch.userId);
        const branchId = employee?.branchId ?? actor?.branchId ?? null;
        const payable =
          branchId == null
            ? null
            : await pushCommissionPayable(tx, {
                userId: batch.userId,
                month: batch.month,
                amount: settledTotal,
                branchId,
                name: fullName(employee ?? { firstName: `Employee #${batch.userId}` }),
                createdBy: actor?.userId ?? batch.userId,
              });

        if (payable?.id) {
          await tx.commission.updateMany({
            where: { id: { in: settledIds } },
            data: { payableId: payable.id },
          });
        }
        paidCount += claimedCount;

        if (payable?.id) {
          payables.push({
            id: payable.id,
            userId: batch.userId,
            month: batch.month,
            amount: num(payable.amount),
            added: settledTotal,
          });
        }
      }

      return { paidCount, payables };
    });
  }

  /**
   * §9.2 — commission statement per employee. Commission is paid on GROSS sold
   * value, so returns/exchanges never reduce it: there are no return deductions.
   * `original` therefore equals `net` (the actual commission earned, after the
   * daily threshold) and `deductions` is always 0 — kept for API/UI shape.
   */
  async getCommissionStatement(query: { startDate: string; endDate: string; branchId?: string }) {
    const where: any = {
      payPeriodStart: { gte: new Date(query.startDate) },
      payPeriodEnd: { lte: new Date(query.endDate) },
    };
    if (query.branchId) where.sale = { branchId: parseInt(query.branchId) };

    const commissions = await prisma.commission.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const byUser = new Map<number, { user: any; net: number }>();
    for (const c of commissions) {
      let u = byUser.get(c.userId);
      if (!u) {
        u = { user: c.user, net: 0 };
        byUser.set(c.userId, u);
      }
      u.net += Number(c.amount);
    }

    const rows = [...byUser.values()].map((u) => ({
      userId: u.user?.id,
      name: u.user ? `${u.user.firstName} ${u.user.lastName ?? ''}`.trim() : '',
      original: round2(u.net),
      deductions: 0,
      net: round2(u.net),
    }));

    return { period: { startDate: query.startDate, endDate: query.endDate }, rows };
  }

  async getCommissionSummary(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
  }) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const where: any = {
      payPeriodStart: { gte: startDate },
      payPeriodEnd: { lte: endDate },
    };

    const commissions = await prisma.commission.groupBy({
      by: ['userId', 'status'],
      where,
      _sum: { amount: true },
      _count: { id: true },
    });

    const userIds = [...new Set(commissions.map((c) => c.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, commissionRate: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Aggregate by user
    const summaryMap = new Map<number, {
      user: any;
      totalAmount: number;
      pendingAmount: number;
      paidAmount: number;
      totalCount: number;
    }>();

    for (const c of commissions) {
      if (!summaryMap.has(c.userId)) {
        summaryMap.set(c.userId, {
          user: userMap.get(c.userId),
          totalAmount: 0,
          pendingAmount: 0,
          paidAmount: 0,
          totalCount: 0,
        });
      }
      const entry = summaryMap.get(c.userId)!;
      const amount = Number(c._sum.amount || 0);
      entry.totalAmount += amount;
      entry.totalCount += c._count.id;
      if (c.status === 'paid') {
        entry.paidAmount += amount;
      } else {
        entry.pendingAmount += amount;
      }
    }

    return {
      period: { startDate: query.startDate, endDate: query.endDate },
      summary: Array.from(summaryMap.values()),
    };
  }
}

export const employeeService = new EmployeeService();
