import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export const listBranches = async () => {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return branches;
};

export const getBranchById = async (id: number) => {
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) {
    throw new AppError('Branch not found', 404);
  }
  return branch;
};

export const createBranch = async (data: {
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  taxConfig?: Record<string, any>;
  receiptHeader?: string;
  receiptFooter?: string;
}) => {
  const existing = await prisma.branch.findUnique({ where: { code: data.code } });
  if (existing) {
    throw new AppError('Branch code already exists', 409);
  }

  const branch = await prisma.branch.create({
    data: {
      name: data.name,
      code: data.code,
      address: data.address,
      phone: data.phone,
      email: data.email,
      taxConfig: data.taxConfig ?? {},
      receiptHeader: data.receiptHeader,
      receiptFooter: data.receiptFooter,
    },
  });

  return branch;
};

export const updateBranch = async (id: number, data: {
  name?: string;
  code?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  taxConfig?: Record<string, any>;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  isActive?: boolean;
}) => {
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) {
    throw new AppError('Branch not found', 404);
  }

  if (data.code && data.code !== branch.code) {
    const existing = await prisma.branch.findUnique({ where: { code: data.code } });
    if (existing) {
      throw new AppError('Branch code already exists', 409);
    }
  }

  const updated = await prisma.branch.update({
    where: { id },
    data,
  });

  return updated;
};

export const deleteBranch = async (id: number) => {
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) {
    throw new AppError('Branch not found', 404);
  }

  await prisma.branch.update({
    where: { id },
    data: { isActive: false },
  });

  return { message: 'Branch deactivated successfully' };
};
