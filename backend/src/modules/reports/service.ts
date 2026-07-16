import prisma from '../../config/database';
import { getSetting } from '../settings/service';

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

    // §11.0 — trading-day rollups key off businessDate (the shift's day),
    // not createdAt, so late-night sales count to the shift that opened.
    // businessDate is a DATE column: use date-only [gte, lt-next-day) bounds.
    const bdStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const bdEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);

    const where: any = {
      businessDate: { gte: bdStart, lt: bdEnd },
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

    // Daily breakdown — §11.0: bucket by businessDate (trading day), not createdAt.
    const sales = await prisma.sale.findMany({
      where,
      select: { id: true, total: true, businessDate: true, createdAt: true },
    });

    const dailyMap = new Map<string, { count: number; total: number }>();
    for (const sale of sales) {
      // §11.0 — key by the trading day; fall back to createdAt for any legacy
      // row that somehow lacks a businessDate.
      const dateKey = (sale.businessDate ?? sale.createdAt).toISOString().split('T')[0];
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
    // Line-item profit register (one row per sale line; returns as negative rows),
    // grouped by bill, with grand totals. Mirrors the legacy LogicERP P&L sheet.
    // §11.0 — sales roll up by businessDate; returns use their own calendar date.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const round4 = (n: number) => Math.round(n * 10000) / 10000;
    // §tax — GST is always recorded; this flag only controls whether the P&L
    // *reveals* it. OFF → Sale Value = Net (GST hidden); ON → Sale Value = Net −
    // GST, and because the tax was always stored this applies to past bills too.
    const showGst = await getSetting<boolean>('gstComplianceEnabled', false);
    const s = new Date(query.startDate);
    const e = new Date(query.endDate);
    const bdStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const bdEnd = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
    const rangeStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const rangeEnd = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999);

    const branchId = query.branchId ? parseInt(query.branchId) : undefined;
    const branchFilter = branchId ? { branchId } : {};

    const variantSelect = {
      size: true,
      color: true,
      mrpOverride: true,
      costOverride: true,
      product: {
        select: { name: true, mrp: true, costPrice: true, landingPrice: true, cgstRate: true, sgstRate: true },
      },
    };

    const sales = await prisma.sale.findMany({
      where: {
        businessDate: { gte: bdStart, lt: bdEnd },
        status: { in: ['completed', 'partially_returned'] },
        ...branchFilter,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        saleNumber: true,
        items: {
          select: { quantity: true, unitPrice: true, total: true, taxAmount: true, variant: { select: variantSelect } },
        },
      },
    });

    const returns = await prisma.return.findMany({
      where: { createdAt: { gte: rangeStart, lte: rangeEnd }, status: 'completed', ...branchFilter },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        originalSale: { select: { saleNumber: true } },
        items: { select: { quantity: true, unitPrice: true, variant: { select: variantSelect } } },
      },
    });

    const itemName = (v: any) =>
      [v?.product?.name, v?.size, v?.color].filter((x) => x && String(x).trim()).join(' ');

    // Build one register row. `qty` is signed (negative for returns); `net` is the
    // signed line amount actually charged/refunded (post-discount, tax-inclusive).
    const buildRow = (sno: number, billNo: string, v: any, qty: number, net: number, storedTax: number | null) => {
      const purchaseRate = Number(v?.costOverride ?? v?.product?.costPrice ?? 0);
      const saleRate = Number(v?.mrpOverride ?? v?.product?.mrp ?? 0);
      const landingCost = Number(v?.product?.landingPrice ?? purchaseRate);
      const gstRate = Number(v?.product?.cgstRate ?? 0) + Number(v?.product?.sgstRate ?? 0);
      const grossAmount = saleRate * qty;
      // §pnl — profit is measured against LANDING cost (cost after freight/expenses,
      // i.e. what's actually paid), not the bare purchase rate. landingCost falls
      // back to the purchase rate when no landing price is set.
      const totalPurchaseValue = landingCost * qty;
      // Sale Value = net excluding GST — but only when GST display is ON. When
      // OFF, GST stays hidden so Sale Value = Net. Use the stored line tax when we
      // have it (sales); otherwise back it out from the product's GST rate (returns).
      const taxable = !showGst
        ? net
        : storedTax != null
        ? net - storedTax
        : gstRate
        ? net * (100 / (100 + gstRate))
        : net;
      const profitLoss = net - totalPurchaseValue;
      const profitLossPct = totalPurchaseValue !== 0 ? (profitLoss / totalPurchaseValue) * 100 : 0;
      return {
        sno,
        billNo,
        itemName: itemName(v),
        quantity: qty,
        purchaseRate: round2(purchaseRate),
        saleRate: round4(saleRate),
        grossAmount: round2(grossAmount),
        netAmount: round2(net),
        totalPurchaseValue: round2(totalPurchaseValue),
        totalSaleValue: round2(taxable),
        profitLoss: round2(profitLoss),
        profitLossPct: round2(profitLossPct),
        landingCost: round4(landingCost),
        isReturn: qty < 0,
      };
    };

    const rows: ReturnType<typeof buildRow>[] = [];
    let sno = 0;
    for (const sale of sales) {
      for (const it of sale.items) {
        rows.push(buildRow(++sno, sale.saleNumber, it.variant, it.quantity, Number(it.total), Number(it.taxAmount)));
      }
    }
    for (const ret of returns) {
      const billNo = ret.originalSale?.saleNumber ?? `RET-${ret.id}`;
      for (const it of ret.items) {
        const qty = -it.quantity;
        const net = -(Number(it.unitPrice) * it.quantity);
        rows.push(buildRow(++sno, billNo, it.variant, qty, net, null));
      }
    }

    const sum = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((a, r) => a + f(r), 0));
    const totalPurchase = sum((r) => r.totalPurchaseValue);
    const totalProfit = sum((r) => r.profitLoss);
    const totals = {
      quantity: rows.reduce((a, r) => a + r.quantity, 0),
      grossAmount: sum((r) => r.grossAmount),
      netAmount: sum((r) => r.netAmount),
      totalPurchaseValue: totalPurchase,
      totalSaleValue: sum((r) => r.totalSaleValue),
      profitLoss: totalProfit,
      profitLossPct: totalPurchase !== 0 ? round2((totalProfit / totalPurchase) * 100) : 0,
    };

    return { period: { startDate: query.startDate, endDate: query.endDate }, rows, totals };
  }

  // ─── Daily Summary ──────────────────────────────────

  async getDailySummary(query: { date?: string; branchId?: string }) {
    const targetDate = query.date ? new Date(query.date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // §11.0 — the EOD trading-day summary keys sales off businessDate (the shift's
    // day), so a post-midnight sale counts to the shift that opened. businessDate
    // is a DATE column → use date-only [gte, lt-next-day) bounds.
    const bdStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const bdEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);

    const salesWhere: any = {
      businessDate: { gte: bdStart, lt: bdEnd },
      status: { in: ['completed', 'partially_returned'] },
    };
    // Returns have no businessDate column (§11.0 scope is sales); keep the
    // calendar-day createdAt window for the returns rollup.
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
    // §11.0 — day-of-week & monthly rollups key off businessDate (trading day).
    // businessDate is a DATE column → date-only [gte, lt-next-day) bounds.
    if (query.startDate || query.endDate) {
      where.businessDate = {};
      if (query.startDate) {
        const s = new Date(query.startDate);
        where.businessDate.gte = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      }
      if (query.endDate) {
        const e = new Date(query.endDate);
        where.businessDate.lt = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
      }
    }

    const sales = await prisma.sale.findMany({
      where,
      select: {
        total: true,
        businessDate: true,
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
      // §11.0 — bucket by the trading day (businessDate), not createdAt; fall
      // back to createdAt for any legacy row lacking a businessDate.
      const d = new Date(s.businessDate ?? s.createdAt);
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

  /**
   * §2.3 — monthly Owner Discretion Discount review. Lists every discretionary
   * discount granted (from the `sale.discretionaryDiscount` audit trail) in the
   * given month, with the total ₹ granted and a per-cashier breakdown.
   */
  async getDiscretionaryDiscountReport(query: { month?: string; branchId?: string }) {
    // month = 'YYYY-MM'; default to the current month if absent.
    const now = new Date();
    const m = /^\d{4}-\d{2}$/.test(query.month || '')
      ? query.month!
      : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [y, mo] = m.split('-').map(Number);
    const start = new Date(Date.UTC(y, mo - 1, 1));
    const end = new Date(Date.UTC(y, mo, 1));

    const logs = await prisma.auditLog.findMany({
      where: {
        // §11.0 N/A — this is an audit report over raw AuditLog rows, which have
        // no businessDate; it intentionally keys off the raw createdAt timestamp.
        action: 'sale.discretionaryDiscount',
        createdAt: { gte: start, lt: end },
        ...(query.branchId ? { branchId: Number(query.branchId) } : {}),
      },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const entries = logs.map((l) => {
      const d = (l.data as any) || {};
      return {
        createdAt: l.createdAt,
        saleNumber: d.saleNumber ?? null,
        customerId: d.customerId ?? null,
        variantId: d.variantId ?? null,
        pct: Number(d.pct ?? 0),
        amount: Number(d.amount ?? 0),
        userId: l.userId,
        userName: l.user ? `${l.user.firstName} ${l.user.lastName}`.trim() : null,
      };
    });

    const totalAmount = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const byUser = Array.from(
      entries.reduce((map, e) => {
        const k = e.userId ?? 0;
        const cur = map.get(k) || { userId: e.userId, userName: e.userName, count: 0, amount: 0 };
        cur.count += 1;
        cur.amount = Math.round((cur.amount + e.amount) * 100) / 100;
        map.set(k, cur);
        return map;
      }, new Map<number, { userId: number | null; userName: string | null; count: number; amount: number }>())
        .values()
    );

    return { month: m, count: entries.length, totalAmount, byUser, entries };
  }

  // ─── Child Birthday Marketing Report (bug #6) ─────────────────────────────

  /**
   * Lists customers whose child's birthday falls in the given calendar month
   * (1-12), for birthday marketing outreach.
   */
  async getChildBirthdayReport(month: number) {
    const customers = await prisma.customer.findMany({
      where: { childBirthMonth: month },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        childBirthMonth: true,
      },
      orderBy: { firstName: 'asc' },
    });

    return { month, count: customers.length, customers };
  }

  // ─── §8.4 Variance reports (read straight from the variance log) ──────────

  /**
   * §8.4 Daily Variance Report — one row per mode (Cash/UPI/Card) per day in the
   * range. Reads the pre-computed variance_logs; never recalculates. Per-mode
   * first (never combined, §8.2). Variance is signed: + short, − over/mismatch.
   */
  async getDailyVarianceReport(query: { startDate: string; endDate: string; branchId?: string }) {
    const start = new Date(query.startDate);
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);

    const where: any = { date: { gte: start, lte: end } };
    if (query.branchId) where.branchId = parseInt(query.branchId, 10);

    const logs = await prisma.varianceLog.findMany({
      where,
      orderBy: [{ date: 'desc' }, { mode: 'asc' }],
    });

    const rows = logs.map((l) => {
      const variance = Number(l.variance);
      return {
        date: l.date.toISOString().slice(0, 10),
        mode: l.mode,
        expected: Number(l.expected),
        actual: Number(l.actual),
        variance,
        // Cash: Short/Over; UPI/Card: Mismatch (any non-zero) — per 8.1a-7/8.1b-3/8.1c-2.
        direction: variance === 0 ? 'balanced' : l.mode === 'cash' ? (variance > 0 ? 'short' : 'over') : 'mismatch',
        approval: l.pinApproved ? 'pin' : 'auto',
        reason: l.reason ?? null,
        pinApprovedAt: l.pinApprovedAt ? l.pinApprovedAt.toISOString() : null,
      };
    });

    return { startDate: query.startDate, endDate: query.endDate, rows };
  }

  /**
   * §8.4 Monthly Variance Report — per-mode rollup for a month. Net (signed) AND
   * absolute totals are both reported: a month of ₹50 short on 10 days and ₹50
   * over on 10 days nets to ₹0 but is not a clean month, so the two figures must
   * never collapse into one. Per-mode first (never combined, §8.2).
   */
  async getMonthlyVarianceReport(query: { month: string; branchId?: string }) {
    // month is "YYYY-MM".
    const [y, m] = query.month.split('-').map((n) => parseInt(n, 10));
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59, 999);

    const where: any = { date: { gte: start, lte: end } };
    if (query.branchId) where.branchId = parseInt(query.branchId, 10);

    const logs = await prisma.varianceLog.findMany({ where, orderBy: [{ date: 'asc' }] });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const byMode: Record<string, {
      mode: string;
      netVariance: number;
      absVariance: number;
      daysPinApproved: number;
      daysAutoApproved: number;
      largest: { date: string; variance: number; reason: string | null } | null;
    }> = {};
    for (const mode of ['cash', 'upi', 'card']) {
      byMode[mode] = { mode, netVariance: 0, absVariance: 0, daysPinApproved: 0, daysAutoApproved: 0, largest: null };
    }

    for (const l of logs) {
      const bucket = byMode[l.mode];
      if (!bucket) continue;
      const variance = Number(l.variance);
      bucket.netVariance = round2(bucket.netVariance + variance);
      bucket.absVariance = round2(bucket.absVariance + Math.abs(variance));
      if (l.pinApproved) bucket.daysPinApproved += 1;
      else bucket.daysAutoApproved += 1;
      if (!bucket.largest || Math.abs(variance) > Math.abs(bucket.largest.variance)) {
        bucket.largest = { date: l.date.toISOString().slice(0, 10), variance, reason: l.reason ?? null };
      }
    }

    // Per-mode first; each mode's figures remain fully separable (§8.2).
    return { month: query.month, modes: ['cash', 'upi', 'card'].map((mode) => byMode[mode]) };
  }
}

export const reportService = new ReportService();
