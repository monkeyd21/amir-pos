import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { isDashboardSenior } from '@clothing-erp/shared';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { dismiss, getDashboard, getLayout, resetLayout, saveLayout } from './service';
import { onChange } from './events';
import { drill, DrillKind } from './drill';
import { stockList, stockTotals } from './inventory-reminder';
import { resolveViewerPeriod } from './service';
import { payableService } from '../payables/service';
import { getSetting, setSetting } from '../settings/service';
import { AlertSettings, DEFAULT_ALERT_SETTINGS } from './alerts';
import prisma from '../../config/database';
import { recordAudit } from '../../services/audit';

const router = Router();
router.use(authenticate);

const viewerOf = (req: AuthRequest) => ({
  userId: req.user!.userId,
  role: req.user!.role,
  branchId: req.user!.branchId,
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const dashboardSchema = z.object({
  query: z.object({
    period: z.enum(['today', 'week', 'month', 'custom']).default('today'),
    from: ymd.optional(),
    to: ymd.optional(),
  }),
});

router.get('/', validate(dashboardSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query as { period?: string; from?: string; to?: string };
    const data = await getDashboard(viewerOf(req), {
      period: (q.period ?? 'today') as any,
      from: q.from,
      to: q.to,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * §1.4 live updates as Server-Sent Events. Read with `fetch` (not
 * EventSource) so the bearer token travels in a header, never in a URL that
 * ends up in proxy logs. A heartbeat keeps proxies from closing an idle line.
 */
router.get('/stream', (req: AuthRequest, res: Response) => {
  const branchId = req.user!.branchId;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx would otherwise buffer the stream and deliver nothing until it closes.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);

  let pending: NodeJS.Timeout | null = null;
  const off = onChange((c) => {
    if (c.branchId != null && c.branchId !== branchId) return;
    // A checkout is several writes in a row; tell the browser once.
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      res.write(`event: change\ndata: ${JSON.stringify(c)}\n\n`);
    }, 400);
  });
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);

  req.on('close', () => {
    off();
    clearInterval(heartbeat);
    if (pending) clearTimeout(pending);
  });
});

const drillSchema = z.object({
  params: z.object({
    kind: z.enum([
      'sales', 'bills', 'discount', 'payments', 'profit', 'returns', 'customers',
      'staff', 'product', 'held', 'eod', 'attendance', 'loyalty',
    ]),
  }),
  query: z.object({
    period: z.enum(['today', 'week', 'month', 'custom']).default('today'),
    from: ymd.optional(),
    to: ymd.optional(),
    id: z.string().regex(/^\d+$/).optional(),
    mode: z.enum(['cash', 'card', 'upi', 'voucher']).optional(),
  }),
});

/** §1.6: the detail behind a card, row or alert, for the side panel. */
router.get('/drill/:kind', validate(drillSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const data = await drill(viewerOf(req), req.params.kind as DrillKind, {
      period: (q.period ?? 'today') as any,
      from: q.from,
      to: q.to,
      id: q.id ? Number(q.id) : undefined,
      mode: q.mode,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

const qualitySchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({ note: z.string().max(500).optional().nullable() }).optional(),
});

/**
 * §1.6 repeat-return alert → "Mark for quality check". Recorded on the
 * article with who and why, and audited. DELETE clears it once checked.
 */
router.post('/products/:id/quality-check', validate(qualitySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isDashboardSenior(req.user!.role)) throw new AppError('Only an owner or manager can do this', 403);
    const id = Number(req.params.id);
    const note = req.body?.note?.trim() || null;
    const product = await prisma.product.update({
      where: { id },
      data: { qualityCheckAt: new Date(), qualityCheckBy: req.user!.userId, qualityCheckNote: note },
      select: { id: true, name: true, qualityCheckAt: true },
    });
    await recordAudit(prisma, {
      action: 'product.quality_check_marked',
      entityType: 'product',
      entityId: id,
      userId: req.user!.userId,
      branchId: req.user!.branchId,
      reason: note ?? undefined,
      data: { name: product.name },
    });
    res.status(201).json({ success: true, data: product });
  } catch (e) {
    next(e);
  }
});

router.delete('/products/:id/quality-check', validate(qualitySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isDashboardSenior(req.user!.role)) throw new AppError('Only an owner or manager can do this', 403);
    const id = Number(req.params.id);
    await prisma.product.update({
      where: { id },
      data: { qualityCheckAt: null, qualityCheckBy: null, qualityCheckNote: null },
    });
    await recordAudit(prisma, {
      action: 'product.quality_check_cleared',
      entityType: 'product',
      entityId: id,
      userId: req.user!.userId,
      branchId: req.user!.branchId,
    });
    res.json({ success: true, data: null });
  } catch (e) {
    next(e);
  }
});

const seniorOnly = (req: AuthRequest) => {
  if (!isDashboardSenior(req.user!.role)) throw new AppError('Only an owner or manager can do this', 403);
};

/**
 * §15.2: "No Expense Today", marked on purpose. A blank day is never read as
 * zero, so this is the only way an expense-free day stops being pending.
 */
router.post('/actions/no-expense', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    seniorOnly(req);
    const { bdDate } = await resolveViewerPeriod(viewerOf(req), { period: 'today' });
    await prisma.expenseDayMark.upsert({
      where: { branchId_businessDate: { branchId: req.user!.branchId, businessDate: bdDate } },
      create: { branchId: req.user!.branchId, businessDate: bdDate, markedBy: req.user!.userId },
      update: {},
    });
    res.status(201).json({ success: true, data: null });
  } catch (e) {
    next(e);
  }
});

const expenseSchema = z.object({
  body: z.object({
    categoryId: z.number().int().positive(),
    amount: z.number().positive(),
    method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque']),
    note: z.string().max(300).optional().nullable(),
  }),
});

/**
 * §1.6 quick action: an expense paid today, recorded through the Payables
 * module's own create and pay (its category rules and audit apply), dated to
 * the trading day so the widget clears.
 */
router.post('/actions/expense', validate(expenseSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    seniorOnly(req);
    const { businessDate } = await resolveViewerPeriod(viewerOf(req), { period: 'today' });
    const category = await prisma.expenseCategory.findUnique({ where: { id: req.body.categoryId } });
    if (!category) throw new AppError('Expense category not found', 404);
    const note = req.body.note?.trim() || null;
    const created = await payableService.create(
      { title: note || category.name, amount: req.body.amount, categoryId: category.id, dueDate: businessDate, description: note },
      req.user!.branchId,
      req.user!.userId
    );
    const open = await prisma.posSession.findFirst({
      where: { branchId: req.user!.branchId, status: 'open' },
      select: { id: true },
    });
    const paid = await payableService.pay(
      created.id,
      // Cash handed out of the till belongs to the open shift's drawer count.
      { amount: req.body.amount, method: req.body.method, sessionId: req.body.method === 'cash' ? open?.id ?? null : null },
      req.user!.userId
    );
    res.status(201).json({ success: true, data: paid });
  } catch (e) {
    next(e);
  }
});

const stockSchema = z.object({
  query: z.object({
    view: z.enum(['low', 'stagnant']),
    days: z.enum(['30', '45', '60', '90']).optional(),
  }),
});

/**
 * §15.6: the list behind the weekly reminder's "View report →" until the
 * Reports module ships. Same query as the strip.
 */
router.get('/stock', validate(stockSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    seniorOnly(req);
    const { businessDate } = await resolveViewerPeriod(viewerOf(req), { period: 'today' });
    const days = Number(req.query.days ?? 60);
    const view = req.query.view as 'low' | 'stagnant';
    const [rows, totals] = await Promise.all([
      stockList(req.user!.branchId, view, businessDate, days),
      stockTotals(req.user!.branchId, view, businessDate, days),
    ]);
    res.json({ success: true, data: { view, days, asOf: businessDate, rows, totals } });
  } catch (e) {
    next(e);
  }
});

/** §8: the configurable alert thresholds (held-bill age, loyalty look-ahead). */
router.get('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    seniorOnly(req);
    const saved = await getSetting<Partial<AlertSettings>>('dashboardAlerts', {});
    res.json({ success: true, data: { ...DEFAULT_ALERT_SETTINGS, ...saved } });
  } catch (e) {
    next(e);
  }
});

const settingsSchema = z.object({
  body: z.object({
    heldBillHours: z.number().min(0.5).max(24),
    loyaltyExpiryDays: z.number().int().min(1).max(60),
  }),
});

router.put('/settings', validate(settingsSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'owner') throw new AppError('Only the owner can change alert thresholds', 403);
    await setSetting('dashboardAlerts', req.body);
    res.json({ success: true, data: req.body });
  } catch (e) {
    next(e);
  }
});

const dismissSchema = z.object({
  body: z.object({ key: z.string().min(3).max(200).regex(/^(alert|insight|weekly):/) }),
});

router.post('/dismissals', validate(dismissSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // §8.1: only an owner or manager may clear an alert off the board.
    if (!isDashboardSenior(req.user!.role)) throw new AppError('Only an owner or manager can dismiss this', 403);
    await dismiss(viewerOf(req), req.body.key);
    res.status(201).json({ success: true, data: { key: req.body.key } });
  } catch (e) {
    next(e);
  }
});

const deviceSchema = z.object({ params: z.object({ device: z.enum(['desktop', 'mobile']) }) });

router.get('/layout/:device', validate(deviceSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getLayout(req.user!.userId, req.params.device as any) });
  } catch (e) {
    next(e);
  }
});

const boxSchema = z.object({
  id: z.string().min(1).max(40),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});
const layoutSchema = z.object({
  params: z.object({ device: z.enum(['desktop', 'mobile']) }),
  body: z.object({ version: z.number().int().min(1), boxes: z.array(boxSchema).max(40) }),
});

router.put('/layout/:device', validate(layoutSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await saveLayout(req.user!.userId, req.params.device as any, req.body);
    res.json({ success: true, data: req.body });
  } catch (e) {
    next(e);
  }
});

router.delete('/layout/:device', validate(deviceSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await resetLayout(req.user!.userId, req.params.device as any);
    res.json({ success: true, data: null });
  } catch (e) {
    next(e);
  }
});

export default router;
