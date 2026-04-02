import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { reportService } from './service';

function toCsv(data: any[], columns?: string[]): string {
  if (!data || data.length === 0) return '';

  const headers = columns || Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape quotes and wrap in quotes if contains comma/quote/newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

function sendCsvResponse(res: Response, data: any[], filename: string, columns?: string[]) {
  const csv = toCsv(data, columns);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

export class ReportController {
  async salesReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.getSalesReport(req.query as any);

      if (req.query.format === 'csv') {
        return sendCsvResponse(res, result.dailyBreakdown, 'sales-report.csv', [
          'date',
          'count',
          'total',
        ]);
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async inventoryReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.getInventoryReport(req.query as any);

      if (req.query.format === 'csv') {
        return sendCsvResponse(res, result.items, 'inventory-report.csv', [
          'branchName',
          'productName',
          'brand',
          'category',
          'sku',
          'size',
          'color',
          'quantity',
          'minStockLevel',
          'isLowStock',
          'costPrice',
          'stockValue',
        ]);
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async customerReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.getCustomerReport(req.query as any);

      if (req.query.format === 'csv') {
        return sendCsvResponse(res, result.topCustomers, 'customer-report.csv', [
          'id',
          'firstName',
          'lastName',
          'phone',
          'loyaltyTier',
          'loyaltyPoints',
          'totalSpent',
          'visitCount',
        ]);
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async commissionReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.getCommissionReport(req.query as any);

      if (req.query.format === 'csv') {
        const csvData = result.employeeSummary.map((e) => ({
          employeeId: e.user.id,
          firstName: e.user.firstName,
          lastName: e.user.lastName,
          totalCommission: e.totalCommission,
          paidAmount: e.paidAmount,
          pendingAmount: e.pendingAmount,
          salesCount: e.salesCount,
        }));
        return sendCsvResponse(res, csvData, 'commission-report.csv');
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async pnlReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.getPnlReport(req.query as any);

      if (req.query.format === 'csv') {
        const csvData = [
          ...result.revenue.items.map((r) => ({
            type: 'Revenue',
            accountCode: r.accountCode,
            accountName: r.accountName,
            amount: r.amount,
          })),
          { type: 'Revenue Total', accountCode: '', accountName: '', amount: result.revenue.total },
          ...result.expenses.items.map((e) => ({
            type: 'Expense',
            accountCode: e.accountCode,
            accountName: e.accountName,
            amount: e.amount,
          })),
          { type: 'Expense Total', accountCode: '', accountName: '', amount: result.expenses.total },
          { type: 'Net Income', accountCode: '', accountName: '', amount: result.netIncome },
        ];
        return sendCsvResponse(res, csvData, 'pnl-report.csv');
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async dailySummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await reportService.getDailySummary(req.query as any);

      if (req.query.format === 'csv') {
        if (result.branchBreakdown.length > 0) {
          return sendCsvResponse(res, result.branchBreakdown, 'daily-summary.csv');
        }
        const csvData = [
          {
            date: result.date,
            totalSales: result.totalSales,
            salesCount: result.salesCount,
            totalReturns: result.totalReturns,
            returnsCount: result.returnsCount,
            totalExpenses: result.totalExpenses,
            netRevenue: result.netRevenue,
          },
        ];
        return sendCsvResponse(res, csvData, 'daily-summary.csv');
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const reportController = new ReportController();
