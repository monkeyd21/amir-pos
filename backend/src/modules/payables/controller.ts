import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { payableService } from './service';
import { Ym } from '../../utils/ist';

/**
 * The active branch for a request. D11 — every payable carries a branchId and
 * it defaults to the caller's active branch. Only an owner may aim a request
 * at another branch (the same rule `applyBranchOverride` enforces on the
 * X-Branch-Id header).
 */
const viewerOf = (req: AuthRequest) => ({
  role: req.user!.role,
  branchId: req.user!.branchId,
});

const branchOf = (req: AuthRequest): number => {
  const raw = req.query.branchId;
  if (req.user!.role === 'owner' && raw) {
    const parsed = parseInt(String(raw), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return req.user!.branchId;
};

class PayableController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await payableService.list(req.query as any, branchOf(req));
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) {
      next(e);
    }
  }

  async ensureMonth(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await payableService.ensureMonth(
        req.body.month as Ym,
        branchOf(req),
        req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  }

  async summary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.summary(req.query as any, branchOf(req));
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  async outstanding(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.outstanding(branchOf(req));
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  async listCategories(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.listCategories(req.query.includeInactive === 'true');
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  async createCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.createCategory(req.body);
      res.status(201).json({ success: true, data, message: 'Category created' });
    } catch (e) {
      next(e);
    }
  }

  async updateCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.updateCategory(parseInt(req.params.id, 10), req.body);
      res.json({ success: true, data, message: 'Category updated' });
    } catch (e) {
      next(e);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.getById(parseInt(req.params.id, 10), viewerOf(req));
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const branchId =
        req.user!.role === 'owner' && req.body.branchId ? req.body.branchId : req.user!.branchId;
      const data = await payableService.create(req.body, branchId, req.user!.userId);
      res.status(201).json({ success: true, data, message: 'Entry added' });
    } catch (e) {
      next(e);
    }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.update(parseInt(req.params.id, 10), req.body, viewerOf(req));
      res.json({ success: true, data, message: 'Entry updated' });
    } catch (e) {
      next(e);
    }
  }

  async pay(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.pay(
        parseInt(req.params.id, 10),
        req.body,
        req.user!.userId,
        viewerOf(req)
      );
      res.status(201).json({ success: true, data, message: 'Payment recorded' });
    } catch (e) {
      next(e);
    }
  }

  async void(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await payableService.void(parseInt(req.params.id, 10), viewerOf(req));
      res.json({ success: true, data, message: 'Entry voided' });
    } catch (e) {
      next(e);
    }
  }
}

export const payableController = new PayableController();
export default payableController;
