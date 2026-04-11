import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * Colors are a preset palette shared by the variant editors. We keep the
 * model tiny — `name` is the unique key, `hex` is optional for swatches.
 * Variant rows continue to store the color NAME as a plain string, so the
 * table exists purely for the UI picker and for consistency of spellings.
 */

export const listColors = async () => {
  return prisma.color.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
};

export const createColor = async (data: { name: string; hex?: string }) => {
  const name = data.name.trim();
  if (!name) {
    throw new AppError('Name is required', 400);
  }

  // Uniqueness is by exact name — we do a case-insensitive pre-check so
  // "Navy" and "navy" don't both end up in the list.
  const existing = await prisma.color.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    throw new AppError('Color with this name already exists', 409);
  }

  return prisma.color.create({
    data: {
      name,
      hex: data.hex?.trim() || null,
    },
  });
};
