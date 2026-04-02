import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { slugify, getPagination, buildPaginationMeta } from '../../utils/helpers';

interface ListBrandsQuery {
  search?: string;
  page?: string;
  limit?: string;
}

export const listBrands = async (query: ListBrandsQuery) => {
  const { page, limit, skip } = getPagination(query);

  const where: any = { isActive: true };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { slug: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [brands, total] = await Promise.all([
    prisma.brand.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.brand.count({ where }),
  ]);

  return { brands, meta: buildPaginationMeta(page, limit, total) };
};

export const getBrandById = async (id: number) => {
  const brand = await prisma.brand.findUnique({
    where: { id },
    include: { products: { where: { isActive: true }, take: 10 } },
  });

  if (!brand) {
    throw new AppError('Brand not found', 404);
  }

  return brand;
};

export const createBrand = async (data: { name: string; logoUrl?: string }) => {
  const slug = slugify(data.name);

  const existing = await prisma.brand.findUnique({ where: { slug } });
  if (existing) {
    throw new AppError('Brand with this name already exists', 409);
  }

  const brand = await prisma.brand.create({
    data: {
      name: data.name,
      slug,
      logoUrl: data.logoUrl,
    },
  });

  return brand;
};

export const updateBrand = async (id: number, data: {
  name?: string;
  logoUrl?: string | null;
  isActive?: boolean;
}) => {
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    throw new AppError('Brand not found', 404);
  }

  const updateData: any = { ...data };

  if (data.name) {
    const slug = slugify(data.name);
    const existing = await prisma.brand.findUnique({ where: { slug } });
    if (existing && existing.id !== id) {
      throw new AppError('Brand with this name already exists', 409);
    }
    updateData.slug = slug;
  }

  const updated = await prisma.brand.update({
    where: { id },
    data: updateData,
  });

  return updated;
};

export const deleteBrand = async (id: number) => {
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    throw new AppError('Brand not found', 404);
  }

  await prisma.brand.update({
    where: { id },
    data: { isActive: false },
  });

  return { message: 'Brand deactivated successfully' };
};
