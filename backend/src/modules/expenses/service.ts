import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';

export class ExpenseService {
  async list(query: {
    page?: string;
    limit?: string;
    branchId?: string;
    categoryId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.branchId) where.branchId = parseInt(query.branchId);
    if (query.categoryId) where.categoryId = parseInt(query.categoryId);
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) where.date.lte = new Date(query.endDate);
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          category: true,
          branch: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          approver: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.expense.count({ where }),
    ]);

    return { data: expenses, meta: buildPaginationMeta(page, limit, total) };
  }

  async getById(id: number) {
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        category: true,
        branch: true,
        creator: { select: { id: true, firstName: true, lastName: true, email: true } },
        approver: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    return expense;
  }

  async create(data: {
    branchId: number;
    categoryId: number;
    amount: number;
    description: string;
    date: string;
    paymentMethod: string;
    receiptUrl?: string | null;
    createdBy: number;
  }) {
    return prisma.expense.create({
      data: {
        branchId: data.branchId,
        categoryId: data.categoryId,
        amount: data.amount,
        description: data.description,
        date: new Date(data.date),
        paymentMethod: data.paymentMethod,
        receiptUrl: data.receiptUrl,
        createdBy: data.createdBy,
      },
      include: {
        category: true,
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: number, data: {
    categoryId?: number;
    amount?: number;
    description?: string;
    date?: string;
    paymentMethod?: string;
    receiptUrl?: string | null;
  }) {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    if (expense.status !== 'pending') {
      throw new AppError('Can only update pending expenses', 400);
    }

    const updateData: any = { ...data };
    if (data.date) updateData.date = new Date(data.date);

    return prisma.expense.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });
  }

  async approve(id: number, approvedBy: number) {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    if (expense.status !== 'pending') {
      throw new AppError('Expense is not pending', 400);
    }

    return prisma.expense.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy,
      },
      include: { category: true },
    });
  }

  async reject(id: number, approvedBy: number) {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    if (expense.status !== 'pending') {
      throw new AppError('Expense is not pending', 400);
    }

    return prisma.expense.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedBy,
      },
      include: { category: true },
    });
  }

  async listCategories() {
    return prisma.expenseCategory.findMany({
      where: { isActive: true },
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(data: { name: string; accountId?: number | null }) {
    return prisma.expenseCategory.create({
      data,
      include: { account: { select: { id: true, code: true, name: true } } },
    });
  }

  async updateCategory(id: number, data: { name?: string; accountId?: number | null; isActive?: boolean }) {
    const category = await prisma.expenseCategory.findUnique({ where: { id } });
    if (!category) {
      throw new AppError('Expense category not found', 404);
    }

    return prisma.expenseCategory.update({
      where: { id },
      data,
      include: { account: { select: { id: true, code: true, name: true } } },
    });
  }

  async getSummary(query: { startDate: string; endDate: string; branchId?: string }) {
    const where: any = {
      status: 'approved',
      date: {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      },
    };

    if (query.branchId) where.branchId = parseInt(query.branchId);

    const expenses = await prisma.expense.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
      _count: { id: true },
    });

    const categories = await prisma.expenseCategory.findMany({
      where: { id: { in: expenses.map((e) => e.categoryId) } },
    });

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const summary = expenses.map((e) => ({
      categoryId: e.categoryId,
      categoryName: categoryMap.get(e.categoryId) || 'Unknown',
      totalAmount: e._sum.amount,
      count: e._count.id,
    }));

    const totalAmount = summary.reduce(
      (acc, s) => acc + Number(s.totalAmount || 0),
      0
    );

    return { summary, totalAmount, period: { startDate: query.startDate, endDate: query.endDate } };
  }
}

export const expenseService = new ExpenseService();
