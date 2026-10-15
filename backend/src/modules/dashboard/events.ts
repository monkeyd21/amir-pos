import { EventEmitter } from 'events';
import { NextFunction, Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';

/**
 * Dashboard spec §1.4: every completed transaction updates the dashboard with
 * no manual refresh.
 *
 * Rather than asking every write path to remember to announce itself (the
 * same "one forgotten path and the numbers drift" trap as a delta summary
 * table), ONE middleware watches every successful write and announces it once
 * the response has gone out. Dashboards listening on the stream then refetch.
 * A new write path is covered the day it is added, with nothing to remember.
 *
 * The server runs as one process, so an in-memory emitter is enough. If it
 * ever scales out, this becomes a Postgres LISTEN/NOTIFY with the same API.
 */

export interface DashboardChange {
  /** Null when the write had no signed-in user (a payment webhook): every branch refetches. */
  branchId: number | null;
  /** The route that changed something, e.g. "POST /api/v1/pos/checkout". */
  source: string;
  at: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

/** Writes that cannot change anything a dashboard shows. */
const IGNORED_PREFIXES = ['/api/v1/auth', '/api/v1/dashboard/layout', '/api/v1/printing', '/api/v1/shop/cart'];

export function publishChange(change: Omit<DashboardChange, 'at'>) {
  bus.emit('change', { ...change, at: new Date().toISOString() });
}

export function onChange(listener: (c: DashboardChange) => void): () => void {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}

export function dashboardChangeNotifier(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const path = req.originalUrl.split('?')[0];
  // Staff API, and the storefront (an online order is a sale too).
  const watched =
    path.startsWith('/api/v1/') ||
    path.startsWith('/api/shop/v1/checkout/place') ||
    path.startsWith('/api/shop/v1/orders') ||
    path.startsWith('/api/shop/v1/webhooks');
  if (!watched || IGNORED_PREFIXES.some((p) => path.startsWith(p))) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const user = (req as AuthRequest).user;
    publishChange({ branchId: user?.branchId ?? null, source: `${req.method} ${path}` });
  });
  next();
}
