import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * §bug4 — Sizes are a preset list shared by the variant editors so users create
 * sizes like "6-9M", "9-12M", "S", "32" once and reuse them. Mirrors colors:
 * variant rows keep storing the size NAME as a plain string, so the table exists
 * purely for the picker and for consistent spellings. `sortOrder` lets the list
 * be arranged sensibly (e.g. age bands ascending); ties fall back to name.
 */

export const listSizes = async () => {
  return prisma.size.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
};

export const createSize = async (data: { name: string; sortOrder?: number }) => {
  const name = data.name.trim();
  if (!name) {
    throw new AppError('Name is required', 400);
  }

  // Case-insensitive uniqueness so "6-9M" and "6-9m" don't both get added.
  const existing = await prisma.size.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    throw new AppError('Size with this name already exists', 409);
  }

  return prisma.size.create({
    data: {
      name,
      sortOrder: Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : 0,
    },
  });
};
