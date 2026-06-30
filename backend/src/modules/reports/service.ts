import prisma from '../../config/database';
import { accountingService } from '../accounting/service';

export class ReportService {
  // ─── Sales Report ───────────────────────────────────

  async getSalesReport(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
    productId?: string;
    brandId?: string;
    groupBy?: 'day' | 'week' | 'month';
  }) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const where: any = {
      createdAt: { gte: startDate, lte: endDate },
      status: { in: ['completed', 'partially_returned'] },
    };
    if (query.branchId) where.branchId = parseInt(query.branchId);

    // Aggregate totals
    const totals = await prisma.sale.aggregate({
      where,
      _sum: { total: true, subtotal: true, taxAmount: true, discountAmount: true },
      _count: { id: true },
      _avg: { total: true },
    });

    // Total items sold
    const itemsWhere: any = { sale: where };
    const itemCount = await prisma.saleItem.aggregate({
      where: itemsWhere,
      _sum: { quantity: true },
    });

    // Top products
    const topProducts = await prisma.saleItem.groupBy({
      by: ['variantId'],
      where: itemsWhere,
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    });

    const variantIds = topProducts.map((p) => p.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { include: { brand: true } } },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const topProductsData = topProducts.map((p) => {
      const variant = variantMap.get(p.variantId);
      return {
        variantId: p.variantId,
        productName: variant?.product.name || 'Unknown',
        sku: variant?.sku || 'Unknown',
        size: variant?.size,
        color: variant?.color,
        brand: variant?.product.brand.name,
        quantitySold: p._sum.quantity,
        totalRevenue: p._sum.total,
      };
    });

    // Daily breakdown
    const sales = await prisma.sale.findMany({
      where,
      select: { id: true, total: true, createdAt: true },
    });

    const dailyMap = new Map<string, { count: number; total: number }>();
    for (const sale of sales) {
      const dateKey = sale.createdAt.toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || { count: 0, total: 0 };
      existing.count++;
      existing.total += Number(sale.total);
      dailyMap.set(dateKey, existing);
    }

    const dailyBreakdown = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      period: { startDate: query.startDate, endDate: query.endDate },
      totalSales: Number(totals._sum.total || 0),
      totalSubtotal: Number(totals._sum.subtotal || 0),
      totalTax: Number(totals._sum.taxAmount || 0),
      totalDiscount: Number(totals._sum.discountAmount || 0),
      transactionCount: totals._count.id,
      averageTransactionValue: Number(totals._avg.total || 0),
      totalItemsSold: Number(itemCount._sum.quantity || 0),
      topProducts: topProductsData,
      dailyBreakdown,
    };
  }

  // ─── Inventory Report ───────────────────────────────

  async getInventoryReport(query: { branchId?: string }) {
    const where: any = {};
    if (query.branchId) where.branchId = parseInt(query.branchId);

    const inventory = await prisma.inventory.findMany({
      where,
      include: {
        variant: {
          include: {
            product: {
              include: { brand: true, category: true },
            },
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { quantity: 'asc' },
    });

    const stockItems = inventory.map((inv) => ({
      branchId: inv.branchId,
      branchName: inv.branch.name,
      productName: inv.variant.product.name,
      brand: inv.variant.product.brand.name,
      category: inv.variant.product.category.name,
      sku: inv.variant.sku,
      size: inv.variant.size,
      color: inv.variant.color,
      quantity: inv.quantity,
      minStockLevel: inv.minStockLevel,
      isLowStock: inv.quantity <= inv.minStockLevel,
      costPrice: Number(inv.variant.costOverride || inv.variant.product.costPrice),
      stockValue: inv.quantity * Number(inv.variant.costOverride || inv.variant.product.costPrice),
    }));

    const totalStockValue = stockItems.reduce((sum, item) => sum + item.stockValue, 0);
    const lowStockItems = stockItems.filter((item) => item.isLowStock);
    const outOfStockItems = stockItems.filter((item) => item.quantity === 0);

    // Stock value per branch
    const branchValues = new Map<string, number>();
    for (const item of stockItems) {
      const existing = branchValues.get(item.branchName) || 0;
      branchValues.set(item.branchName, existing + item.stockValue);
    }

    return {
      totalItems: stockItems.length,
      totalStockValue,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      stockValuePerBranch: Object.fromEntries(branchValues),
      items: stockItems,
      lowStockItems: lowStockItems.slice(0, 20),
    };
  }

  // ─── Customer Report ────────────────────────────────

  async getCustomerReport(query: { startDate?: string; endDate?: string }) {
    const dateFilter: any = {};
    if (query.startDate) dateFilter.gte = new Date(query.startDate);
    if (query.endDate) dateFilter.lte = new Date(query.endDate);

    // Total customers
    const totalCustomers = await prisma.customer.count();

    // New customers in period
    const newCustomersWhere: any = {};
    if (query.startDate || query.endDate) {
      newCustomersWhere.createdAt = dateFilter;
    }
    const newCustomers = await prisma.customer.count({ where: newCustomersWhere });

    // Tier distribution
    const tierDistribution = await prisma.customer.groupBy({
      by: ['loyaltyTier'],
      _count: { id: true },
    });

    // Top customers by spend
    const topCustomers = await prisma.customer.findMany({
      orderBy: { totalSpent: 'desc' },
      take: 10,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        loyaltyTier: true,
        loyaltyPoints: true,
        totalSpent: true,
        visitCount: true,
      },
    });

    // Repeat rate: customers with more than 1 visit
    const repeatCustomers = await prisma.customer.count({
      where: { visitCount: { gt: 1 } },
    });
    const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

    return {
      totalCustomers,
      newCustomers,
      repeatCustomers,
      repeatRate: Math.round(repeatRate * 100) / 100,
      tierDistribution: tierDistribution.map((t) => ({
        tier: t.loyaltyTier,
        count: t._count.id,
      })),
      topCustomers,
    };
  }

  // ─── Commission Report ──────────────────────────────

  async getCommissionReport(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
  }) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    const where: any = {
      payPeriodStart: { gte: startDate },
      payPeriodEnd: { lte: endDate },
    };

    const commissions = await prisma.commission.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, branchId: true, commissionRate: true },
        },
        sale: { select: { id: true, saleNumber: true, total: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter by branch if specified
    const filtered = query.branchId
      ? commissions.filter((c) => c.user.branchId === parseInt(query.branchId!))
      : commissions;

    // Summary per employee
    const employeeSummary = new Map<number, {
      user: any;
      totalCommission: number;
      paidAmount: number;
      pendingAmount: number;
      salesCount: number;
    }>();

    for (const c of filtered) {
      if (!employeeSummary.has(c.userId)) {
        employeeSummary.set(c.userId, {
          user: c.user,
          totalCommission: 0,
          paidAmount: 0,
          pendingAmount: 0,
          salesCount: 0,
        });
      }
      const entry = employeeSummary.get(c.userId)!;
      const amount = Number(c.amount);
      entry.totalCommission += amount;
      entry.salesCount++;
      if (c.status === 'paid') {
        entry.paidAmount += amount;
      } else {
        entry.pendingAmount += amount;
      }
    }

    const totalCommission = filtered.reduce((sum, c) => sum + Number(c.amount), 0);

    return {
      period: { startDate: query.startDate, endDate: query.endDate },
      totalCommission,
      totalRecords: filtered.length,
      employeeSummary: Array.from(employeeSummary.values()),
      details: filtered,
    };
  }

  // ─── P&L Report (delegates to accounting) ──────────

  async getPnlReport(query: {
    startDate: string;
    endDate: string;
    branchId?: string;
  }) {
    return accountingService.getProfitAndLoss(query);
  }

  // ─── Daily Summary ──────────────────────────────────

  async getDailySummary(query: { date?: string; branchId?: string }) {
    const targetDate = query.date ? new Date(query.date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const salesWhere: any = {
      createdAt: { gte: startOfDay, lte: endOfDay },
      status: { in: ['completed', 'partially_returned'] },
    };
    const returnsWhere: any = {
      createdAt: { gte: startOfDay, lte: endOfDay },
      status: 'completed',
    };
    const expensesWhere: any = {
      date: { gte: startOfDay, lte: endOfDay },
      status: 'approved',
    };

    if (query.branchId) {
      const branchId = parseInt(query.branchId);
      salesWhere.branchId = branchId;
      returnsWhere.branchId = branchId;
      expensesWhere.branchId = branchId;
    }

    const [salesAgg, returnsAgg, expensesAgg, salesCount, returnsCount] = await Promise.all([
      prisma.sale.aggregate({
        where: salesWhere,
        _sum: { total: true },
      }),
      prisma.return.aggregate({
        where: returnsWhere,
        _sum: { total: true },
      }),
      prisma.expense.aggregate({
        where: expensesWhere,
        _sum: { amount: true },
      }),
      prisma.sale.count({ where: salesWhere }),
      prisma.return.count({ where: returnsWhere }),
    ]);

    const totalSales = Number(salesAgg._sum.total || 0);
    const totalReturns = Number(returnsAgg._sum.total || 0);
    const totalExpenses = Number(expensesAgg._sum.amount || 0);
    const netRevenue = totalSales - totalReturns - totalExpenses;

    // Per branch breakdown if no branch filter
    let branchBreakdown: any[] = [];
    if (!query.branchId) {
      const branches = await prisma.branch.findMany({ where: { isActive: true } });
      branchBreakdown = await Promise.all(
        branches.map(async (branch) => {
          const branchSales = await prisma.sale.aggregate({
            where: { ...salesWhere, branchId: branch.id },
            _sum: { total: true },
          });
          const branchReturns = await prisma.return.aggregate({
            where: { ...returnsWhere, branchId: branch.id },
            _sum: { total: true },
          });
          const branchExpenses = await prisma.expense.aggregate({
            where: { ...expensesWhere, branchId: branch.id },
            _sum: { amount: true },
          });

          const sales = Number(branchSales._sum.total || 0);
          const returns = Number(branchReturns._sum.total || 0);
          const expenses = Number(branchExpenses._sum.amount || 0);

          return {
            branchId: branch.id,
            branchName: branch.name,
            sales,
            returns,
            expenses,
            netRevenue: sales - returns - expenses,
          };
        })
      );
    }

    // §4.5 — active held bills for the EOD report (cashier, remarks, age).
    await prisma.heldTransaction.deleteMany({
      where: { expiresAt: { not: null, lt: new Date() } },
    });
    const heldRows = await prisma.heldTransaction.findMany({
      where: query.branchId ? { branchId: parseInt(query.branchId) } : {},
      include: { user: { select: { firstName: true, lastName: true } }, customer: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = Date.now();
    const activeHolds = heldRows.map((h) => ({
      id: h.id,
      cashier: h.user ? `${h.user.firstName} ${h.user.lastName ?? ''}`.trim() : '',
      customer: h.customer ? `${h.customer.firstName} ${h.customer.lastName ?? ''}`.trim() : null,
      remarks: h.notes ?? null,
      ageMinutes: Math.floor((now - new Date(h.createdAt).getTime()) / 60000),
    }));

    return {
      date: targetDate.toISOString().split('T')[0],
      totalSales,
      salesCount,
      totalReturns,
      returnsCount,
      totalExpenses,
      netRevenue,
      branchBreakdown,
      activeHolds,
      activeHoldsCount: activeHolds.length,
    };
  }

  /**
   * §10 — Business performance: profit summary (10.1), day-of-week ratings
   * (10.2), and monthly sales/profit/margin with insights (10.3).
   */
  async getPerformance(query: { startDate?: string; endDate?: string; branchId?: string }) {
    const where: any = { status: { in: ['completed', 'partially_returned'] } };
    if (query.branchId) where.branchId = parseInt(query.branchId);
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const sales = await prisma.sale.findMany({
      where,
      select: {
        total: true,
        createdAt: true,
        items: { select: { quantity: true, variant: { select: { product: { select: { costPrice: true } } } } } },
      },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    let totalSales = 0;
    let totalCost = 0;
    const dow = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
    const monthly = new Map<string, { sales: number; cost: number }>();

    for (const s of sales) {
      const amt = Number(s.total);
      const cogs = s.items.reduce(
        (c, i) => c + i.quantity * Number(i.variant?.product?.costPrice || 0),
        0
      );
      totalSales += amt;
      totalCost += cogs;
      const d = new Date(s.createdAt);
      dow[d.getDay()].total += amt;
      dow[d.getDay()].count += 1;
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = monthly.get(mk) ?? { sales: 0, cost: 0 };
      m.sales += amt;
      m.cost += cogs;
      monthly.set(mk, m);
    }

    const totalProfit = round2(totalSales - totalCost);
    const avgProfitPercent = totalSales > 0 ? round2((totalProfit / totalSales) * 100) : 0;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowAgg = dow.map((d, i) => ({
      day: dayNames[i],
      totalSales: round2(d.total),
      avgSales: d.count ? round2(d.total / d.count) : 0,
      transactions: d.count,
    }));
    const maxAvg = Math.max(...dowAgg.map((d) => d.avgSales), 1);
    const dayOfWeek = dowAgg.map((d) => {
      const r = d.avgSales / maxAvg;
      const rating = r >= 0.8 ? 'Best' : r >= 0.6 ? 'Strong' : r >= 0.3 ? 'Good' : 'Slow';
      return { ...d, rating };
    });

    const monthlyArr = [...monthly.entries()].sort().map(([month, v]) => {
      const profit = round2(v.sales - v.cost);
      return { month, sales: round2(v.sales), profit, marginPercent: v.sales > 0 ? round2((profit / v.sales) * 100) : 0 };
    });

    const pick = (arr: any[], cmp: (a: any, b: any) => boolean) =>
      arr.reduce((best, x) => (best === null || cmp(x, best) ? x : best), null as any);
    const bestMonth = pick(monthlyArr, (a, b) => a.sales > b.sales);
    const worstMonth = pick(monthlyArr, (a, b) => a.sales < b.sales);
    const bestDay = pick(dayOfWeek, (a, b) => a.avgSales > b.avgSales);

    // §10.4 — proactive, rule-based recommendations from the same data (Phase-1;
    // no ML). Surfaced on the dashboard.
    const recommendations: string[] = [];
    if (bestDay && bestDay.avgSales > 0) {
      recommendations.push(`Stock up before ${bestDay.day} — historically your strongest day.`);
    }
    const zeroDays = dayOfWeek.filter((d) => d.transactions === 0).map((d) => d.day);
    if (zeroDays.length && zeroDays.length < 7) {
      recommendations.push(`No sales recorded on ${zeroDays.join(', ')} — consider a promotion or shorter hours.`);
    }
    if (avgProfitPercent > 0 && avgProfitPercent < 25) {
      recommendations.push(`Average margin is ${avgProfitPercent}% — review pricing or supplier costs.`);
    }

    return {
      overall: { totalSales: round2(totalSales), totalCost: round2(totalCost), totalProfit, avgProfitPercent },
      dayOfWeek,
      monthly: monthlyArr,
      insights: {
        bestMonth: bestMonth?.month ?? null,
        worstMonth: worstMonth?.month ?? null,
        bestDay: bestDay?.day ?? null,
      },
      recommendations,
    };
  }
}

export const reportService = new ReportService();
