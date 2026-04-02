import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';

export class EmployeeService {
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

  async calculateCommissions(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
  }) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const salesWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
      status: 'completed',
    };
    if (query.branchId) salesWhere.branchId = parseInt(query.branchId);

    // Get all sales in the period with their cashiers
    const sales = await prisma.sale.findMany({
      where: salesWhere,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, commissionRate: true } },
      },
    });

    // Check for existing commissions in this period to avoid duplicates
    const existingSaleIds = new Set(
      (
        await prisma.commission.findMany({
          where: {
            saleId: { in: sales.map((s) => s.id) },
          },
          select: { saleId: true },
        })
      ).map((c) => c.saleId)
    );

    const newCommissions: Array<{
      userId: number;
      saleId: number;
      amount: number;
      rate: number;
      payPeriodStart: Date;
      payPeriodEnd: Date;
    }> = [];

    for (const sale of sales) {
      if (existingSaleIds.has(sale.id)) continue;

      const commissionRate = Number(sale.user.commissionRate);
      if (commissionRate <= 0) continue;

      const amount = Number(sale.total) * (commissionRate / 100);

      newCommissions.push({
        userId: sale.userId,
        saleId: sale.id,
        amount: Math.round(amount * 100) / 100,
        rate: commissionRate,
        payPeriodStart: startDate,
        payPeriodEnd: endDate,
      });
    }

    if (newCommissions.length > 0) {
      await prisma.commission.createMany({ data: newCommissions });
    }

    return {
      created: newCommissions.length,
      skipped: existingSaleIds.size,
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
