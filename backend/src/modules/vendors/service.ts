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

// ─── Vendor ledger ───────────────────────────────────────────────
//
// totalPurchased = sum of (unitCost × quantity) across all purchase
//                  movements with this vendor (cash + credit)
// totalCreditPurchased = same sum but only for paymentMode=credit — this
//                  is the part that ever entered AP
// totalPaid      = sum of all VendorPayment.amount
// balanceOwed    = totalCreditPurchased − totalPaid
//
// Cash purchases never enter AP — they're "settled" at the moment of receipt
// — so totalPurchased is interesting for spend reporting but balanceOwed
// is what the user actually has to pay.
export const getVendorLedger = async (vendorId: number) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError('Vendor not found', 404);

  const [movements, payments] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { vendorId, type: 'purchase' },
      orderBy: { createdAt: 'desc' },
      include: {
        variant: {
          include: { product: { select: { name: true } } },
        },
      },
    }),
    prisma.vendorPayment.findMany({
      where: { vendorId },
      orderBy: { paymentDate: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  let totalPurchased = 0;
  let totalCreditPurchased = 0;
  for (const m of movements) {
    if (!m.unitCost) continue;
    const lineCost = Number(m.unitCost) * m.quantity;
    totalPurchased += lineCost;
    if (m.paymentMode === 'credit') totalCreditPurchased += lineCost;
  }

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balanceOwed = Math.max(0, totalCreditPurchased - totalPaid);

  // Round to paise
  const r = (x: number) => Math.round(x * 100) / 100;

  return {
    vendor,
    summary: {
      totalPurchased: r(totalPurchased),
      totalCreditPurchased: r(totalCreditPurchased),
      totalPaid: r(totalPaid),
      balanceOwed: r(balanceOwed),
      purchaseCount: movements.length,
      paymentCount: payments.length,
    },
    movements: movements.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      productName: m.variant.product.name,
      sku: m.variant.sku,
      size: m.variant.size,
      color: m.variant.color,
      quantity: m.quantity,
      unitCost: m.unitCost ? Number(m.unitCost) : null,
      lineCost: m.unitCost ? r(Number(m.unitCost) * m.quantity) : null,
      paymentMode: m.paymentMode,
      dueDate: m.dueDate,
      lotCode: m.lotCode,
      notes: m.notes,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      paymentDate: p.paymentDate,
      createdBy: `${p.user.firstName} ${p.user.lastName}`.trim(),
      createdAt: p.createdAt,
    })),
  };
};

export const recordVendorPayment = async (data: {
  vendorId: number;
  amount: number;
  method: string;
  reference?: string | null;
  notes?: string | null;
  paymentDate?: Date | string;
  createdBy: number;
}) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  if (data.amount <= 0) throw new AppError('Payment amount must be positive', 400);

  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: data.vendorId,
      amount: data.amount,
      method: data.method,
      reference: data.reference ?? null,
      notes: data.notes ?? null,
      paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
      createdBy: data.createdBy,
    },
  });

  return payment;
};
