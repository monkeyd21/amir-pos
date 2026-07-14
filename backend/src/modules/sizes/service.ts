import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * §bug4 — Sizes are a user-managed master list shared by the variant editors so
 * users create sizes like "6-9M", "3-9M" (overlapping), "1Y", "S", "32" once in
 * Settings and just select them when building inventory. Mirrors colors: variant
 * rows keep storing the size NAME as a plain string, so the table exists purely
 * for the picker and consistent spellings. `sortOrder` is set by the user (manual
 * reorder) so the counter sees bands in whatever order is convenient — string
 * sorting can't order "3-6M" vs "12-18M" correctly, so the order is explicit.
 */

export const listSizes = async (opts: { includeInactive?: boolean } = {}) => {
  return prisma.size.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
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

  // New sizes land at the bottom of the list by default (max sortOrder + 1),
  // unless the caller supplies an explicit position.
  let sortOrder = data.sortOrder;
  if (!Number.isFinite(sortOrder)) {
    const last = await prisma.size.findFirst({ orderBy: { sortOrder: 'desc' } });
    sortOrder = (last?.sortOrder ?? 0) + 1;
  }

  return prisma.size.create({ data: { name, sortOrder: Number(sortOrder) } });
};

export const updateSize = async (
  id: number,
  data: { name?: string; sortOrder?: number; isActive?: boolean }
) => {
  const size = await prisma.size.findUnique({ where: { id } });
  if (!size) throw new AppError('Size not found', 404);

  const patch: { name?: string; sortOrder?: number; isActive?: boolean } = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new AppError('Name is required', 400);
    const clash = await prisma.size.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } },
    });
    if (clash) throw new AppError('Size with this name already exists', 409);
    patch.name = name;
  }
  if (data.sortOrder !== undefined && Number.isFinite(data.sortOrder)) {
    patch.sortOrder = Number(data.sortOrder);
  }
  if (data.isActive !== undefined) {
    patch.isActive = Boolean(data.isActive);
  }

  return prisma.size.update({ where: { id }, data: patch });
};

export const deleteSize = async (id: number) => {
  const size = await prisma.size.findUnique({ where: { id } });
  if (!size) throw new AppError('Size not found', 404);
  // Hard delete — variants store the size NAME as a plain string, so removing the
  // master row never breaks existing stock; it just drops the label from pickers.
  await prisma.size.delete({ where: { id } });
  return { id };
};

// Apply a user-defined order in one shot: sortOrder = position in the given id list.
export const reorderSizes = async (ids: number[]) => {
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.size.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  return listSizes({ includeInactive: true });
};
