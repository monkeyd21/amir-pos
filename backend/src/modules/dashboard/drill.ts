import { Prisma } from '@prisma/client';
import { canSeeOnDashboard, dashboardAccess, DashboardElement, returnReasonLabel } from '@clothing-erp/shared';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { dateOnly } from '../../utils/ist';
import { HIGH_DISCOUNT_PCT } from './activity';
import { round1, round2, Scope } from './metrics';
import { addDays, DayRange } from './periods';
import { DashboardQuery, DashboardViewer, resolveViewerPeriod } from './service';

/**
 * Dashboard spec §1.6: tapping a card, row or alert opens a side panel with
 * the detail behind it. Each kind of drill-down is gated by the same §11A
 * element as the box it opens from, and narrowed to the viewer's own bills
 * where their access is "own".
 *
 * These read raw transactions, row-limited and indexed: the one exception
 * §13 allows to "never aggregate the raw tables".
 */

export type DrillKind =
  | 'sales'
  | 'bills'
  | 'discount'
  | 'payments'
  | 'profit'
  | 'returns'
  | 'customers'
  | 'staff'
  | 'product'
  | 'held'
  | 'eod';

const ELEMENT: Record<DrillKind, DashboardElement> = {
  sales: 'sales',
  bills: 'sales',
  discount: 'discount',
  payments: 'paymentSplit',
  profit: 'profit',
  returns: 'returns',
  customers: 'customers',
  staff: 'staff',
  product: 'alerts',
  held: 'recentTransactions',
  eod: 'eod',
};

const LIMIT = 200;

export async function drill(
  viewer: DashboardViewer,
  kind: DrillKind,
  query: DashboardQuery & { id?: number; mode?: string }
) {
  const { businessDate, period } = await resolveViewerPeriod(viewer, query);
  const element = ELEMENT[kind];
  if (!canSeeOnDashboard(viewer.role, element, period.period)) {
    throw new AppError('Not available for your role', 403);
  }
  const own = dashboardAccess(viewer.role, element) === 'own';
  const scope: Scope = { branchId: viewer.branchId, ownUserId: own ? viewer.userId : undefined };
  const range = period.current;

  switch (kind) {
    case 'sales':
      return salesBreakdown(scope, range);
    case 'bills':
      return { bills: await billList(scope, range, {}) };
    case 'discount':
      return { bills: await billList(scope, range, { discountedOnly: true }) };
    case 'payments':
      if (!query.mode) throw new AppError('Which payment mode?', 400);
      return { mode: query.mode, bills: await billList(scope, range, { mode: query.mode }) };
    case 'profit':
      return profitDetail(scope, range);
    case 'returns':
      return { returns: await returnList(scope, range) };
    case 'customers':
      return customerList(scope, range);
    case 'staff': {
      const id = query.id ?? viewer.userId;
      if (own && id !== viewer.userId) throw new AppError('Not available for your role', 403);
      return staffDetail(scope, range, id);
    }
    case 'product':
      if (!query.id) throw new AppError('Which article?', 400);
      return productReturns(viewer.branchId, query.id, businessDate);
    case 'held':
      if (!query.id) throw new AppError('Which held bill?', 400);
      return heldDetail(viewer, query.id);
    case 'eod':
      return eodDetail(viewer.branchId, businessDate);
    default:
      throw new AppError('Unknown drill-down', 400);
  }
}

const bounds = (r: DayRange) => ({ from: dateOnly(r.from), to: dateOnly(r.to) });
const ownSales = (s: Scope) => (s.ownUserId ? Prisma.sql`AND s."userId" = ${s.ownUserId}` : Prisma.empty);

async function salesBreakdown(scope: Scope, range: DayRange) {
  const { from, to } = bounds(range);
  const [byCategory, byHour] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT c.name, COALESCE(SUM(si.total), 0) AS value, COALESCE(SUM(si.quantity), 0) AS items
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN product_variants v ON v.id = si."variantId"
      JOIN products p ON p.id = v."productId"
      JOIN categories c ON c.id = p."categoryId"
      WHERE s."branchId" = ${scope.branchId} AND s."businessDate" BETWEEN ${from} AND ${to} AND s.status <> 'void' ${ownSales(scope)}
      GROUP BY c.name ORDER BY value DESC`,
    prisma.$queryRaw<any[]>`
      SELECT EXTRACT(HOUR FROM (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
             COUNT(*) AS bills, COALESCE(SUM(s.total), 0) AS value
      FROM sales s
      WHERE s."branchId" = ${scope.branchId} AND s."businessDate" BETWEEN ${from} AND ${to} AND s.status <> 'void' ${ownSales(scope)}
      GROUP BY 1 ORDER BY 1`,
  ]);
  return {
    byCategory: byCategory.map((r) => ({ name: r.name, value: round2(Number(r.value)), items: Number(r.items) })),
    byHour: byHour.map((r) => ({ hour: Number(r.hour), bills: Number(r.bills), value: round2(Number(r.value)) })),
  };
}

async function billList(scope: Scope, range: DayRange, opts: { discountedOnly?: boolean; mode?: string }) {
  const { from, to } = bounds(range);
  const sales = await prisma.sale.findMany({
    where: {
      branchId: scope.branchId,
      businessDate: { gte: from, lte: to },
      status: { not: 'void' },
      ...(scope.ownUserId ? { userId: scope.ownUserId } : {}),
      ...(opts.discountedOnly ? { discountAmount: { gt: 0 } } : {}),
      ...(opts.mode ? { payments: { some: { method: opts.mode as any, status: 'completed' } } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
    select: {
      id: true,
      saleNumber: true,
      createdAt: true,
      total: true,
      subtotal: true,
      discountAmount: true,
      exchangeReturnId: true,
      customer: { select: { firstName: true, lastName: true } },
      _count: { select: { items: true } },
      payments: { select: { method: true, amount: true } },
    },
  });
  const rows = sales.map((s) => {
    const pre = Number(s.subtotal);
    const discountPct = pre > 0 ? round1((Number(s.discountAmount) / pre) * 100) : 0;
    return {
      id: s.id,
      number: s.saleNumber,
      at: s.createdAt.toISOString(),
      customer: s.customer ? `${s.customer.firstName} ${s.customer.lastName ?? ''}`.trim() : null,
      lines: s._count.items,
      total: round2(Number(s.total)),
      discount: round2(Number(s.discountAmount)),
      discountPct,
      highDiscount: discountPct > HIGH_DISCOUNT_PCT,
      exchange: s.exchangeReturnId != null,
      modes: [...new Set(s.payments.map((p) => p.method))],
      modeAmount: opts.mode
        ? round2(s.payments.filter((p) => p.method === opts.mode).reduce((t, p) => t + Number(p.amount), 0))
        : null,
    };
  });
  return opts.discountedOnly ? rows.sort((a, b) => b.discountPct - a.discountPct) : rows;
}

async function profitDetail(scope: Scope, range: DayRange) {
  const { from, to } = bounds(range);
  const [byCategory, uncosted] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT c.name,
             COALESCE(SUM(si.total), 0) AS sales,
             COALESCE(SUM(si.total) FILTER (WHERE si."unitCost" IS NOT NULL), 0) AS costed,
             COALESCE(SUM(si."unitCost" * si.quantity) FILTER (WHERE si."unitCost" IS NOT NULL), 0) AS cogs
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN product_variants v ON v.id = si."variantId"
      JOIN products p ON p.id = v."productId"
      JOIN categories c ON c.id = p."categoryId"
      WHERE s."branchId" = ${scope.branchId} AND s."businessDate" BETWEEN ${from} AND ${to} AND s.status <> 'void' ${ownSales(scope)}
      GROUP BY c.name ORDER BY sales DESC`,
    prisma.$queryRaw<any[]>`
      SELECT v.id, v.sku, p.id AS product_id, p.name, v.size, v.color,
             SUM(si.quantity) AS qty, COALESCE(SUM(si.total), 0) AS value
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN product_variants v ON v.id = si."variantId"
      JOIN products p ON p.id = v."productId"
      WHERE s."branchId" = ${scope.branchId} AND s."businessDate" BETWEEN ${from} AND ${to} AND s.status <> 'void'
        AND si."unitCost" IS NULL ${ownSales(scope)}
      GROUP BY v.id, v.sku, p.id, p.name, v.size, v.color
      ORDER BY value DESC
      LIMIT ${LIMIT}`,
  ]);
  return {
    byCategory: byCategory.map((r) => {
      const costed = Number(r.costed);
      const profit = costed - Number(r.cogs);
      return {
        name: r.name,
        sales: round2(Number(r.sales)),
        coveragePct: Number(r.sales) > 0 ? round1((costed / Number(r.sales)) * 100) : null,
        grossProfit: round2(profit),
        marginPct: costed > 0 ? round1((profit / costed) * 100) : null,
      };
    }),
    uncosted: uncosted.map((r) => ({
      variantId: Number(r.id),
      productId: Number(r.product_id),
      sku: r.sku,
      name: r.name,
      size: r.size,
      color: r.color,
      qty: Number(r.qty),
      value: round2(Number(r.value)),
    })),
  };
}

async function returnList(scope: Scope, range: DayRange) {
  const { from, to } = bounds(range);
  const rows = await prisma.return.findMany({
    where: {
      branchId: scope.branchId,
      businessDate: { gte: from, lte: to },
      status: 'completed',
      ...(scope.ownUserId ? { userId: scope.ownUserId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
    select: {
      id: true,
      returnNumber: true,
      type: true,
      reasonCode: true,
      reason: true,
      total: true,
      createdAt: true,
      originalSale: { select: { id: true, saleNumber: true } },
      items: { select: { quantity: true, variant: { select: { size: true, product: { select: { name: true } } } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.returnNumber,
    type: r.type,
    reason: returnReasonLabel(r.reasonCode) ?? r.reason,
    value: round2(Number(r.total)),
    at: r.createdAt.toISOString(),
    saleId: r.originalSale.id,
    saleNumber: r.originalSale.saleNumber,
    items: r.items.map((i) => `${i.variant.product.name} (${i.variant.size})${i.quantity > 1 ? ` ×${i.quantity}` : ''}`),
  }));
}

async function customerList(scope: Scope, range: DayRange) {
  const { from, to } = bounds(range);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT c.id, c."firstName" AS first, c."lastName" AS last, c.phone,
           COUNT(s.id) AS bills, COALESCE(SUM(s.total), 0) AS spent,
           (EXISTS (SELECT 1 FROM sales p WHERE p."customerId" = c.id AND p."businessDate" < ${from} AND p.status <> 'void')
            OR EXISTS (SELECT 1 FROM historical_bills h WHERE h."customerId" = c.id AND h."billDate" < ${from})) AS returning
    FROM sales s JOIN customers c ON c.id = s."customerId"
    WHERE s."branchId" = ${scope.branchId} AND s."businessDate" BETWEEN ${from} AND ${to} AND s.status <> 'void' ${ownSales(scope)}
    GROUP BY c.id, c."firstName", c."lastName", c.phone
    ORDER BY spent DESC
    LIMIT ${LIMIT}`;
  return {
    customers: rows.map((r) => ({
      id: Number(r.id),
      name: `${r.first} ${r.last ?? ''}`.trim(),
      phone: r.phone,
      bills: Number(r.bills),
      spent: round2(Number(r.spent)),
      returning: Boolean(r.returning),
    })),
  };
}

async function staffDetail(scope: Scope, range: DayRange, userId: number) {
  const { from, to } = bounds(range);
  const user = await prisma.user.findFirst({
    where: { id: userId, branchId: scope.branchId },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  if (!user) throw new AppError('Salesperson not found', 404);

  const [agg] = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(SUM(si.total), 0) AS value, COUNT(DISTINCT si."saleId") AS bills,
           COALESCE(SUM(si.quantity), 0) AS items, COALESCE(SUM(si."returnedQuantity"), 0) AS returned
    FROM sale_items si JOIN sales s ON s.id = si."saleId"
    WHERE s."branchId" = ${scope.branchId} AND s."businessDate" BETWEEN ${from} AND ${to}
      AND s.status <> 'void' AND si."agentId" = ${userId} AND si."agentId" <> s."userId"`;

  // Returns of pieces this person sold, whenever they came back (last 30 days of returns).
  const returns = await prisma.$queryRaw<any[]>`
    SELECT r."returnNumber" AS number, r.type, r."reasonCode" AS code, r.reason, r."createdAt" AS at,
           p.name, v.size, ri.quantity, ri."unitPrice" * ri.quantity AS value
    FROM return_items ri
    JOIN returns r ON r.id = ri."returnId"
    JOIN sale_items si ON si.id = ri."saleItemId"
    JOIN product_variants v ON v.id = ri."variantId"
    JOIN products p ON p.id = v."productId"
    WHERE r."branchId" = ${scope.branchId} AND si."agentId" = ${userId}
      AND r."businessDate" >= ${dateOnly(addDays(range.to, -30))} AND r."businessDate" <= ${to}
    ORDER BY r."createdAt" DESC
    LIMIT 50`;

  const bills = Number(agg.bills);
  const items = Number(agg.items);
  return {
    user: { id: user.id, name: `${user.firstName} ${user.lastName ?? ''}`.trim(), role: user.role },
    value: round2(Number(agg.value)),
    bills,
    items,
    upt: bills > 0 ? round2(items / bills) : null,
    avgBill: bills > 0 ? round2(Number(agg.value) / bills) : null,
    returnRate: items > 0 ? round1((Number(agg.returned) / items) * 100) : null,
    returns: returns.map((r) => ({
      number: r.number,
      type: r.type,
      reason: returnReasonLabel(r.code) ?? r.reason,
      at: new Date(r.at).toISOString(),
      item: `${r.name} (${r.size})`,
      value: round2(Number(r.value)),
    })),
  };
}

async function productReturns(branchId: number, productId: number, businessDate: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
      qualityCheckAt: true,
      qualityCheckNote: true,
      qualityChecker: { select: { firstName: true, lastName: true } },
    },
  });
  if (!product) throw new AppError('Article not found', 404);

  const [returns, vendor] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT r."returnNumber" AS number, r.type, r."reasonCode" AS code, r.reason, r."createdAt" AS at,
             v.sku, v.size, v.color, ri.quantity, ri.condition, s."saleNumber" AS sale_number, s.id AS sale_id
      FROM return_items ri
      JOIN returns r ON r.id = ri."returnId"
      JOIN product_variants v ON v.id = ri."variantId"
      JOIN sales s ON s.id = r."originalSaleId"
      WHERE r."branchId" = ${branchId} AND v."productId" = ${productId}
        AND r."businessDate" BETWEEN ${dateOnly(addDays(businessDate, -6))} AND ${dateOnly(businessDate)}
      ORDER BY r."createdAt" DESC`,
    prisma.$queryRaw<any[]>`
      SELECT vd.id, vd.name FROM inventory_movements m
      JOIN product_variants v ON v.id = m."variantId"
      JOIN vendors vd ON vd.id = m."vendorId"
      WHERE v."productId" = ${productId} AND m."vendorId" IS NOT NULL
      ORDER BY m."createdAt" DESC LIMIT 1`,
  ]);

  return {
    product: {
      id: product.id,
      name: product.name,
      category: product.category?.name ?? null,
      brand: product.brand?.name ?? null,
    },
    vendor: vendor[0] ? { id: Number(vendor[0].id), name: vendor[0].name } : null,
    qualityCheck: product.qualityCheckAt
      ? {
          at: product.qualityCheckAt.toISOString(),
          note: product.qualityCheckNote,
          by: product.qualityChecker ? `${product.qualityChecker.firstName} ${product.qualityChecker.lastName ?? ''}`.trim() : null,
        }
      : null,
    returns: returns.map((r) => ({
      number: r.number,
      type: r.type,
      reason: returnReasonLabel(r.code) ?? r.reason,
      at: new Date(r.at).toISOString(),
      variant: [r.size, r.color].filter(Boolean).join(' · '),
      sku: r.sku,
      quantity: Number(r.quantity),
      condition: r.condition,
      saleId: Number(r.sale_id),
      saleNumber: r.sale_number,
    })),
  };
}

async function heldDetail(viewer: DashboardViewer, id: number) {
  const held = await prisma.heldTransaction.findFirst({
    where: { id, branchId: viewer.branchId },
    select: {
      id: true,
      userId: true,
      cartData: true,
      notes: true,
      createdAt: true,
      expiresAt: true,
      customer: { select: { firstName: true, lastName: true, phone: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!held) throw new AppError('This held bill is no longer parked', 404);
  if (dashboardAccess(viewer.role, 'recentTransactions') === 'own' && held.userId !== viewer.userId) {
    throw new AppError('Not available for your role', 403);
  }
  // The parked cart is the POS's own JSON; names are looked up from the
  // variant rather than trusted from it, so any cart shape reads correctly.
  const cart = (((held.cartData as any)?.cart ?? []) as any[]).filter((l) => l && typeof l === 'object');
  const ids = [...new Set(cart.map((l) => Number(l.variantId)).filter((n) => n > 0))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, size: true, color: true, product: { select: { name: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const lines = cart.map((l) => {
    const v = byId.get(Number(l.variantId));
    return {
      name: v?.product.name ?? l.productName ?? l.name ?? 'Unknown article',
      size: v?.size ?? l.size ?? null,
      color: v?.color ?? l.color ?? null,
      quantity: Number(l.quantity ?? 1),
      price: round2(Number(l.price ?? 0)),
    };
  });
  return {
    id: held.id,
    createdAt: held.createdAt.toISOString(),
    expiresAt: held.expiresAt?.toISOString() ?? null,
    customer: held.customer
      ? { name: `${held.customer.firstName} ${held.customer.lastName ?? ''}`.trim(), phone: held.customer.phone }
      : null,
    heldBy: `${held.user.firstName} ${held.user.lastName ?? ''}`.trim(),
    notes: held.notes === 'DEV' ? null : held.notes,
    lines,
    value: round2(lines.reduce((t, l) => t + l.price * l.quantity, 0)),
  };
}

async function eodDetail(branchId: number, businessDate: string) {
  const sessions = await prisma.posSession.findMany({
    where: { branchId, businessDate: dateOnly(businessDate) },
    orderBy: { openedAt: 'asc' },
    select: {
      id: true,
      status: true,
      openedAt: true,
      closedAt: true,
      openingAmount: true,
      expectedAmount: true,
      closingAmount: true,
      pettyCash: true,
      pettyCashReason: true,
      cashDrop: true,
      variance: true,
      varianceReason: true,
      closingFloat: true,
      expectedUpi: true,
      upiReceived: true,
      upiVariance: true,
      expectedCard: true,
      cardReceived: true,
      cardVariance: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  const n = (v: unknown) => (v == null ? null : round2(Number(v)));
  return {
    businessDate,
    sessions: sessions.map((s) => ({
      id: s.id,
      cashier: `${s.user.firstName} ${s.user.lastName ?? ''}`.trim(),
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingFloat: n(s.openingAmount),
      // The till's own figures at close: expected before petty cash, drops and payouts.
      expectedBeforeOutflows: n(s.expectedAmount),
      pettyCash: n(s.pettyCash),
      pettyCashReason: s.pettyCashReason,
      cashDrop: n(s.cashDrop),
      expected: s.closingAmount != null ? round2(Number(s.closingAmount) + Number(s.variance ?? 0)) : null,
      counted: n(s.closingAmount),
      variance: s.closingAmount != null ? round2(-Number(s.variance ?? 0)) : null,
      varianceReason: s.varianceReason,
      closingFloat: n(s.closingFloat),
      upi: { expected: n(s.expectedUpi), received: n(s.upiReceived), variance: s.upiVariance != null ? round2(-Number(s.upiVariance)) : null },
      card: { expected: n(s.expectedCard), received: n(s.cardReceived), variance: s.cardVariance != null ? round2(-Number(s.cardVariance)) : null },
    })),
  };
}
