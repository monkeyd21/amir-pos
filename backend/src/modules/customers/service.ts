import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';

export class CustomerService {
  async list(query: { page?: string; limit?: string; search?: string }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
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
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                variant: {
                  include: { product: true },
                },
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    return customer;
  }

  async create(data: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string | null;
    address?: string | null;
  }) {
    const existing = await prisma.customer.findUnique({
      where: { phone: data.phone },
    });

    if (existing) {
      throw new AppError('A customer with this phone number already exists', 409);
    }

    return prisma.customer.create({ data });
  }

  async update(id: number, data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string | null;
    address?: string | null;
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

    return prisma.customer.update({ where: { id }, data });
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
