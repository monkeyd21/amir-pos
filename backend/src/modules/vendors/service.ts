import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';
import { Prisma } from '@prisma/client';

interface ListVendorsQuery {
  search?: string;
  page?: string;
  limit?: string;
  isActive?: string;
}

export const listVendors = async (query: ListVendorsQuery) => {
  const { page, limit, skip } = getPagination(query);

  const where: Prisma.VendorWhereInput = {};

  if (query.isActive === 'true') {
    where.isActive = true;
  } else if (query.isActive === 'false') {
    where.isActive = false;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { contactPerson: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { gstNumber: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.vendor.count({ where }),
  ]);

  return { vendors, meta: buildPaginationMeta(page, limit, total) };
};

export const getVendorById = async (id: number) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
  });

  if (!vendor) {
    throw new AppError('Vendor not found', 404);
  }

  return vendor;
};

export const createVendor = async (data: {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  paymentTerms?: string;
  notes?: string;
}) => {
  const vendor = await prisma.vendor.create({
    data: {
      name: data.name,
      contactPerson: data.contactPerson || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      gstNumber: data.gstNumber || null,
      paymentTerms: data.paymentTerms || null,
      notes: data.notes || null,
    },
  });

  return vendor;
};

export const updateVendor = async (
  id: number,
  data: {
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    gstNumber?: string | null;
    paymentTerms?: string | null;
    notes?: string | null;
    isActive?: boolean;
  }
) => {
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) {
    throw new AppError('Vendor not found', 404);
  }

  const updated = await prisma.vendor.update({
    where: { id },
    data,
  });

  return updated;
};

export const deleteVendor = async (id: number) => {
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) {
    throw new AppError('Vendor not found', 404);
  }

  await prisma.vendor.update({
    where: { id },
    data: { isActive: false },
  });

  return { message: 'Vendor deactivated successfully' };
};
