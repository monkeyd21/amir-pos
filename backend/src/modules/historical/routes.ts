import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';

// Read-only viewer over the migrated legacy bills archive (historical_bills /
// historical_bill_items). NOT the live sales pipeline.
const router = Router();
router.use(authenticate);

const custSelect = { select: { id: true, firstName: true, lastName: true, phone: true } };

// List — paginated, searchable by bill number / customer / mobile, filter by FY.
router.get('/bills', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const search = String(req.query.search || '').trim();
    const fy = String(req.query.fiscalYear || '').trim();
    const where: any = {};
    if (fy) where.fiscalYear = fy;
    if (search) where.OR = [
      { billNumber: { contains: search, mode: 'insensitive' } },
      { originalBillNo: { contains: search, mode: 'insensitive' } },
      { customerNameRaw: { contains: search, mode: 'insensitive' } },
      { customerMobile: { contains: search } },
    ];
    const [rows, total] = await Promise.all([
      prisma.historicalBill.findMany({
        where,
        include: { customer: custSelect, _count: { select: { items: true } } },
        orderBy: [{ billDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.historicalBill.count({ where }),
    ]);
    res.json({ success: true, data: rows, meta: { total, page, limit } });
  } catch (e) { next(e); }
});

// Bill detail with line items.
router.get('/bills/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bill = await prisma.historicalBill.findUnique({
      where: { id: parseInt(req.params.id, 10) },
      include: { items: true, customer: custSelect },
    });
    if (!bill) return res.status(404).json({ success: false, error: 'Historical bill not found' });
    res.json({ success: true, data: bill });
  } catch (e) { next(e); }
});

// A specific customer's archived bills (for the customer detail page).
router.get('/customers/:customerId/bills', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const bills = await prisma.historicalBill.findMany({
      where: { customerId: parseInt(req.params.customerId, 10) },
      include: { _count: { select: { items: true } } },
      orderBy: [{ billDate: 'desc' }, { id: 'desc' }],
    });
    res.json({ success: true, data: bills });
  } catch (e) { next(e); }
});

// Report summary — totals by fiscal year and by month (cash vs card).
router.get('/summary', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const byFiscalYear = await prisma.historicalBill.groupBy({
      by: ['fiscalYear'],
      _count: { _all: true },
      _sum: { total: true, cashAmount: true, cardAmount: true, taxAmount: true },
      orderBy: { fiscalYear: 'asc' },
    });
    const byMonth: any[] = await prisma.$queryRawUnsafe(
      `SELECT "fiscalYear", to_char("billDate",'YYYY-MM') AS month, count(*)::int AS bills,
              sum(total)::float AS total, sum("cashAmount")::float AS cash, sum("cardAmount")::float AS card
       FROM historical_bills WHERE "billDate" IS NOT NULL
       GROUP BY 1,2 ORDER BY 2`
    );
    res.json({ success: true, data: { byFiscalYear, byMonth } });
  } catch (e) { next(e); }
});

export default router;
