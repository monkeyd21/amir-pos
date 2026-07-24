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
  }) {
    // Email is optional; only enforce uniqueness when one is provided.
    if (body.email) {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw new AppError('Email already in use', 400);
    }

    // Default password — employee should change on first login
    const passwordHash = await bcrypt.hash('changeme123', 12);

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
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        commissionRate: true,
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
      isActive?: boolean;
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
    if (body.isActive !== undefined) data.isActive = body.isActive;

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
    if (query.startDate || query.endDate) {
      where.payPeriodStart = {};
      if (query.startDate) where.payPeriodStart.gte = new Date(query.startDate);
      if (query.endDate) where.payPeriodStart.lte = new Date(query.endDate);
    }

    const [commissions, total] = await Promise.all([
      prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          sale: { select: { id: true, saleNumber: true, total: true } },
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
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);
    const mode = await getSetting<string>('commissionMode', 'item_level');

    const salesWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
      status: 'completed',
    };
    if (query.branchId) salesWhere.branchId = parseInt(query.branchId);

    const sales = await prisma.sale.findMany({
      where: salesWhere,
      include: {
        user: { select: { id: true, commissionRate: true } },
        items: {
          include: {
            agent: { select: { id: true, commissionRate: true } },
          },
        },
        returns: { select: { total: true } },
      },
    });

    const allSaleIds = sales.map((s) => s.id);
    const existingKeys = new Set(
      (
        await prisma.commission.findMany({
          where: { saleId: { in: allSaleIds } },
          select: { saleId: true, userId: true },
        })
      ).map((c) => `${c.saleId}-${c.userId}`)
    );

    const newCommissions: Array<{
      userId: number;
      saleId: number;
      amount: number;
      rate: number;
      payPeriodStart: Date;
      payPeriodEnd: Date;
    }> = [];

    // §commission — minimum DAILY-sales threshold. Commission is earned only on
    // the portion of an employee's own daily sales ABOVE this ₹ figure. 0 = off
    // (every rupee earns commission, i.e. the original behaviour).
    const dailyThreshold =
      Number(await getSetting<number>('commissionDailyThreshold', 0)) || 0;

    // First collect every (employee, sale) commission base, tagged with the
    // trading day, WITHOUT applying the rate yet — we need each employee's full
    // daily total before we know how much of it clears the threshold.
    type Entry = { userId: number; saleId: number; base: number; rate: number; day: string };
    const entries: Entry[] = [];

    for (const sale of sales) {
      const day = (sale.businessDate ?? sale.createdAt).toISOString().slice(0, 10);

      if (mode === 'bill_level') {
        // ── Bill-level: commission on whole sale for the cashier ──
        const rate = Number(sale.user.commissionRate);
        if (rate <= 0) continue;
        // Net out anything already refunded — no commission on returned value.
        const refunded = sale.returns.reduce((s, r) => s + Number(r.total), 0);
        const netTotal = Math.max(0, Number(sale.total) - refunded);
        if (netTotal <= 0) continue;
        entries.push({ userId: sale.userId, saleId: sale.id, base: netTotal, rate, day });
      } else {
        // ── Item-level: commission per agent per line item ──
        const agentTotals = new Map<number, number>();
        for (const item of sale.items) {
          if (!item.agentId || !item.agent) continue;
          // Commission base is the value still sold — exclude returned units.
          const live = item.quantity - item.returnedQuantity;
          if (live <= 0) continue;
          const netLine = Number(item.total) * (live / item.quantity);
          agentTotals.set(item.agentId, (agentTotals.get(item.agentId) ?? 0) + netLine);
        }
        for (const [agentId, lineTotal] of agentTotals) {
          const agent = sale.items.find((i) => i.agentId === agentId)?.agent;
          if (!agent) continue;
          const rate = Number(agent.commissionRate);
          if (rate <= 0) continue;
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

    for (const e of entries) {
      const key = `${e.saleId}-${e.userId}`;
      if (existingKeys.has(key)) continue;
      const base = dailyBase.get(`${e.userId}|${e.day}`) ?? 0;
      // Only the amount above the threshold is commissionable; spread that
      // reduction across the day's sales in proportion to each sale's value.
      const factor = base > 0 ? Math.max(0, base - dailyThreshold) / base : 0;
      const amount = Math.round(e.base * factor * (e.rate / 100) * 100) / 100;
      if (amount <= 0) continue; // day fell below the threshold → no commission
      newCommissions.push({
        userId: e.userId,
        saleId: e.saleId,
        amount,
        rate: e.rate,
        payPeriodStart: startDate,
        payPeriodEnd: endDate,
      });
    }

    if (newCommissions.length > 0) {
      await prisma.commission.createMany({ data: newCommissions });
    }

    return {
      mode,
      created: newCommissions.length,
      skipped: existingKeys.size,
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
        sale: { select: { id: true, saleNumber: true, total: true } },
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
    const where: any = {
      status: 'pending',
      createdAt: {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      },
    };
    if (query.userId) where.userId = query.userId;

    const result = await prisma.commission.updateMany({
      where,
      data: { status: 'paid' },
    });

    return { paidCount: result.count };
  }

  /**
   * §9.2 — monthly commission statement: per employee, the original commission
   * (had nothing been returned), the deductions from returns/exchanges, and the
   * net retained. Net comes from the live commission rows (already reconciled);
   * original is recomputed from the full sale value at the same rate.
   */
  async getCommissionStatement(query: { startDate: string; endDate: string; branchId?: string }) {
    const where: any = {
      payPeriodStart: { gte: new Date(query.startDate) },
      payPeriodEnd: { lte: new Date(query.endDate) },
    };
    if (query.branchId) where.sale = { branchId: parseInt(query.branchId) };

    const commissions = await prisma.commission.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        sale: {
          select: { id: true, userId: true, total: true, items: { select: { agentId: true, total: true } } },
        },
      },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const byUser = new Map<number, { user: any; original: number; net: number }>();
    const seen = new Set<string>();

    for (const c of commissions) {
      let u = byUser.get(c.userId);
      if (!u) {
        u = { user: c.user, original: 0, net: 0 };
        byUser.set(c.userId, u);
      }
      u.net += Number(c.amount);
      const key = `${c.saleId}-${c.userId}`;
      if (!seen.has(key)) {
        seen.add(key);
        let grossBase = c.sale.items
          .filter((i) => i.agentId === c.userId)
          .reduce((s, i) => s + Number(i.total), 0);
        // bill-level fallback: the cashier earns on the whole bill.
        if (grossBase === 0 && c.sale.userId === c.userId) grossBase = Number(c.sale.total);
        u.original += grossBase * (Number(c.rate) / 100);
      }
    }

    const rows = [...byUser.values()].map((u) => ({
      userId: u.user?.id,
      name: u.user ? `${u.user.firstName} ${u.user.lastName ?? ''}`.trim() : '',
      original: round2(u.original),
      deductions: round2(u.original - u.net),
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
