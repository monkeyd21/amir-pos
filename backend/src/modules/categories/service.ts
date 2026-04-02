import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { slugify } from '../../utils/helpers';

interface CategoryWithChildren {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  isActive: boolean;
  createdAt: Date;
  children?: CategoryWithChildren[];
}

const buildTree = (categories: CategoryWithChildren[], parentId: number | null = null): CategoryWithChildren[] => {
  return categories
    .filter((c) => c.parentId === parentId)
    .map((c) => ({
      ...c,
      children: buildTree(categories, c.id),
    }));
};

export const listCategories = async (query: { tree?: string; search?: string }) => {
  const where: any = { isActive: true };

  if (query.search) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  const categories = await prisma.category.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  if (query.tree === 'true') {
    return buildTree(categories as CategoryWithChildren[]);
  }

  return categories;
};

export const getCategoryById = async (id: number) => {
  const category = await prisma.category.findUnique({
    where: { id },
    include: {
      parent: true,
      children: { where: { isActive: true } },
    },
  });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  return category;
};

export const createCategory = async (data: { name: string; parentId?: number | null }) => {
  const slug = slugify(data.name);

  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) {
    throw new AppError('Category with this name already exists', 409);
  }

  if (data.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
    if (!parent) {
      throw new AppError('Parent category not found', 404);
    }
  }

  const category = await prisma.category.create({
    data: {
      name: data.name,
      slug,
      parentId: data.parentId ?? null,
    },
  });

  return category;
};

export const updateCategory = async (id: number, data: {
  name?: string;
  parentId?: number | null;
  isActive?: boolean;
}) => {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) {
    throw new AppError('Category not found', 404);
  }

  const updateData: any = { ...data };

  if (data.name) {
    const slug = slugify(data.name);
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing && existing.id !== id) {
      throw new AppError('Category with this name already exists', 409);
    }
    updateData.slug = slug;
  }

  if (data.parentId !== undefined) {
    if (data.parentId === id) {
      throw new AppError('Category cannot be its own parent', 400);
    }
    if (data.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
      if (!parent) {
        throw new AppError('Parent category not found', 404);
      }
    }
  }

  const updated = await prisma.category.update({
    where: { id },
    data: updateData,
  });

  return updated;
};

export const deleteCategory = async (id: number) => {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) {
    throw new AppError('Category not found', 404);
  }

  await prisma.category.update({
    where: { id },
    data: { isActive: false },
  });

  return { message: 'Category deactivated successfully' };
};
