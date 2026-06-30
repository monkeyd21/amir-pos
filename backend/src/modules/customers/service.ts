import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';

export class CustomerService {
  async list(query: { page?: string; limit?: string; search?: string; query?: string }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};
    const searchTerm = query.search || query.query;

    if (searchTerm) {
      where.OR = [
        { firstName: { contains: searchTerm, mode: 'insensitive' } },
        { lastName: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      data: customers,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async getById(id: number) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        sales: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            items: {
              include: {
                variant: {
                  include: { product: { include: { brand: true } } },
                },
                agent: { select: { id: true, firstName: true, lastName: true } },
              },
            },
            payments: true,
          },
        },
        loyaltyTransactions: {
          take: 20,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Compute stats
    const lastSale = customer.sales[0] ?? null;
    const avgOrderValue =
      customer.visitCount > 0
        ? Number(customer.totalSpent) / customer.visitCount
        : 0;

    return {
      ...customer,
      stats: {
        totalSpent: Number(customer.totalSpent),
        visitCount: customer.visitCount,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        lastPurchaseDate: lastSale?.createdAt ?? null,
        loyaltyPoints: customer.loyaltyPoints,
        loyaltyTier: customer.loyaltyTier,
      },
    };
  }

  async topCustomers(query: { limit?: string; sortBy?: string }) {
    const take = Math.min(parseInt(query.limit || '5', 10) || 5, 50);
    const sortBy = query.sortBy || 'totalSpent';

    let orderBy: any;
    switch (sortBy) {
      case 'visitCount':
        orderBy = { visitCount: 'desc' };
        break;
      case 'loyaltyPoints':
        orderBy = { loyaltyPoints: 'desc' };
        break;
      case 'totalSpent':
      default:
        orderBy = { totalSpent: 'desc' };
        break;
    }

    const customers = await prisma.customer.findMany({
      take,
      orderBy,
      include: {
        sales: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        },
      },
    });

    return customers.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      email: c.email,
      totalSpent: Number(c.totalSpent),
      visitCount: c.visitCount,
      loyaltyPoints: c.loyaltyPoints,
      loyaltyTier: c.loyaltyTier,
      lastPurchaseDate: c.sales[0]?.createdAt ?? null,
    }));
  }

  async create(data: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string | null;
    address?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
  }) {
    const existing = await prisma.customer.findUnique({
      where: { phone: data.phone },
    });

    if (existing) {
      throw new AppError('A customer with this phone number already exists', 409);
    }

    const { dateOfBirth, ...rest } = data;
    return prisma.customer.create({
      data: { ...rest, dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null },
    });
  }

  async update(id: number, data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string | null;
    address?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
  }) {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    if (data.phone && data.phone !== customer.phone) {
      const existing = await prisma.customer.findUnique({
        where: { phone: data.phone },
      });
      if (existing) {
        throw new AppError('A customer with this phone number already exists', 409);
      }
    }

    const { dateOfBirth, ...rest } = data;
    const updateData: any = { ...rest };
    if (dateOfBirth !== undefined) {
      updateData.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    }
    return prisma.customer.update({ where: { id }, data: updateData });
  }

  /**
   * §5.6 AI Phase-1 (rule-based) — preferred size + likely category from the
   * MODE of the customer's last 3 purchased items. Returns nulls when there are
   * fewer than 3 purchases (cold start → POS shows nothing).
   */
  async getPurchaseSuggestion(id: number): Promise<{
    preferredSize: string | null;
    likelyCategory: string | null;
  }> {
    const sales = await prisma.sale.findMany({
      where: { customerId: id, status: { in: ['completed', 'partially_returned'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        items: {
          include: {
            variant: { include: { product: { include: { category: true } } } },
          },
        },
      },
    });

    const recentItems = sales.flatMap((s) => s.items).slice(0, 3);
    if (recentItems.length < 3) {
      return { preferredSize: null, likelyCategory: null };
    }

    const mode = (values: (string | null | undefined)[]): string | null => {
      const counts = new Map<string, number>();
      for (const v of values) {
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestN = 0;
      for (const [v, n] of counts) {
        if (n > bestN) {
          best = v;
          bestN = n;
        }
      }
      return best;
    };

    return {
      preferredSize: mode(recentItems.map((i) => i.variant?.size)),
      likelyCategory: mode(recentItems.map((i) => i.variant?.product?.category?.name)),
    };
  }

  async getPurchaseHistory(id: number, query: { page?: string; limit?: string }) {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const { page, limit, skip } = getPagination(query);
    const where = { customerId: id };

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
          payments: true,
          branch: { select: { id: true, name: true } },
        },
      }),
      prisma.sale.count({ where }),
    ]);

    return {
      data: sales,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async getLoyaltyHistory(id: number, query: { page?: string; limit?: string }) {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const { page, limit, skip } = getPagination(query);
    const where = { customerId: id };

    const [transactions, total] = await Promise.all([
      prisma.loyaltyTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sale: { select: { id: true, saleNumber: true, total: true } },
        },
      }),
      prisma.loyaltyTransaction.count({ where }),
    ]);

    return {
      data: transactions,
      meta: buildPaginationMeta(page, limit, total),
    };
  }
}

export const customerService = new CustomerService();
