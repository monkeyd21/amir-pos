import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';

interface ListUsersQuery {
  page?: string;
  limit?: string;
  branchId?: string;
  role?: string;
  search?: string;
}

export const listUsers = async (query: ListUsersQuery) => {
  const { page, limit, skip } = getPagination(query);

  const where: any = { isActive: true };

  if (query.branchId) {
    where.branchId = parseInt(query.branchId, 10);
  }
  if (query.role) {
    where.role = query.role;
  }
  if (query.search) {
    where.OR = [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        branchId: true,
        commissionRate: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, meta: buildPaginationMeta(page, limit, total) };
};

export const getUserById = async (id: number) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      branchId: true,
      commissionRate: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      branch: { select: { id: true, name: true, code: true } },
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  return user;
};

export const createUser = async (data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: string;
  branchId: number;
  commissionRate?: number;
}) => {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existingUser) {
    throw new AppError('Email already in use', 409);
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      role: data.role as any || 'staff',
      branchId: data.branchId,
      commissionRate: data.commissionRate ?? 0,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      branchId: true,
      commissionRate: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
};

export const updateUser = async (id: number, data: {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  role?: string;
  branchId?: number;
  commissionRate?: number;
  isActive?: boolean;
}) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (data.email && data.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new AppError('Email already in use', 409);
    }
  }

  const updateData: any = { ...data };
  if (data.role) updateData.role = data.role as any;

  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      branchId: true,
      commissionRate: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
};

export const deleteUser = async (id: number) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  return { message: 'User deactivated successfully' };
};
