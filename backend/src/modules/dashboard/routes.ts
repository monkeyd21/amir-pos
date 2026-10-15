import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { isDashboardSenior } from '@clothing-erp/shared';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { dismiss, getDashboard, getLayout, resetLayout, saveLayout } from './service';
import { onChange } from './events';

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
