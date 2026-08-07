import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';
import { getSetting } from '../settings/service';

export class EmployeeService {
  // ─── Employee CRUD ─────────────────────────────────

  async list(query: { page?: string; limit?: string; search?: string; status?: string }) {
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
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const data = employees.map((e) => ({
      ...e,
      status: e.isActive ? 'active' : 'inactive',
    }));

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
        isActive: true,
        branch: { select: { id: true, name: true } },
        createdAt: true,
      },
    });
  }

  // ─── Attendance ─────────────────────────────────────

  async clockIn(userId: number, branchId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check for existing clock-in today
    const existing = await prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    if (existing) {
      throw new AppError('Already clocked in today', 400);
    }

    return prisma.attendance.create({
      data: {
        userId,
        branchId,
        clockIn: new Date(),
        date: today,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async clockOut(userId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
    });

    if (!attendance) {
      throw new AppError('No clock-in record found for today', 400);
    }

    if (attendance.clockOut) {
      throw new AppError('Already clocked out today', 400);
    }

    const clockOut = new Date();
    const hoursWorked =
      (clockOut.getTime() - attendance.clockIn.getTime()) / (1000 * 60 * 60);

    return prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        clockOut,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async listAttendance(query: {
    page?: string;
    limit?: string;
    userId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.userId) where.userId = parseInt(query.userId);
    if (query.branchId) where.branchId = parseInt(query.branchId);
    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      prisma.attendance.count({ where }),
    ]);

    return { data: records, meta: buildPaginationMeta(page, limit, total) };
  }

  async getAttendanceSummary(query: { month: string; branchId?: string }) {
    const [year, month] = query.month.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month

    const where: any = {
      date: { gte: startDate, lte: endDate },
    };
    if (query.branchId) where.branchId = parseInt(query.branchId);

    const attendance = await prisma.attendance.groupBy({
      by: ['userId'],
      where,
      _count: { id: true },
      _sum: { hoursWorked: true },
    });

    const userIds = attendance.map((a) => a.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, branchId: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const summary = attendance.map((a) => ({
      userId: a.userId,
      user: userMap.get(a.userId),
      daysPresent: a._count.id,
      totalHours: Number(a._sum.hoursWorked || 0),
    }));

    return { month: query.month, summary };
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

    const [commissions, total] = await Promise.all([
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
    ]);

    return { data: commissions, meta: buildPaginationMeta(page, limit, total) };
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

  async payCommission(id: number) {
    const commission = await prisma.commission.findUnique({ where: { id } });
    if (!commission) {
      throw new AppError('Commission not found', 404);
    }

    if (commission.status === 'paid') {
      throw new AppError('Commission is already paid', 400);
    }

    return prisma.commission.update({
      where: { id },
      data: { status: 'paid' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        sale: { select: { id: true, saleNumber: true, total: true, businessDate: true, createdAt: true } },
      },
    });
  }

  /**
   * Mark all pending commissions in a date range as paid. Optionally filter by employee.
   */
  async payCommissionsBulk(query: {
    startDate: string;
    endDate: string;
    userId?: number;
  }) {
    // Match by the BILL date (sale.businessDate ?? sale.createdAt), same as the
    // list — so "pay 01–05 Aug" pays commissions for bills from those days, not
    // whenever the calc run happened to insert the rows.
    const where: any = {
      status: 'pending',
      sale: this.billDateSaleFilter(query.startDate, query.endDate),
    };
    if (query.userId) where.userId = query.userId;

    // updateMany can't filter on a relation, so resolve the ids first.
    const ids = (await prisma.commission.findMany({ where, select: { id: true } })).map((c) => c.id);
    if (ids.length === 0) return { paidCount: 0 };

    const result = await prisma.commission.updateMany({
      where: { id: { in: ids } },
      data: { status: 'paid' },
    });

    return { paidCount: result.count };
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
