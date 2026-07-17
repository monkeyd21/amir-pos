import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';

const router = Router();

router.use(authenticate);

// Audit trail is sensitive — owners/managers only.
router.get(
  '/',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page, limit, skip } = getPagination(req.query as any);
      const where: any = {};
      if (req.query.entityType) where.entityType = String(req.query.entityType);
      if (req.query.entityId) where.entityId = String(req.query.entityId);
      if (req.query.action) where.action = { contains: String(req.query.action), mode: 'insensitive' };
      if (req.query.userId) where.userId = parseInt(String(req.query.userId), 10);

      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({ success: true, data: rows, meta: buildPaginationMeta(page, limit, total) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
