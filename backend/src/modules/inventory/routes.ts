import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { inventoryController } from './controller';
import {
  listInventorySchema,
  adjustStockSchema,
  restockSchema,
  createTransferSchema,
  transferParamsSchema,
  updateMovementSchema,
  listMovementsSchema,
} from './validators';
import { upload } from '../../middleware/upload';
import prisma from '../../config/database';
import { recordAudit } from '../../services/audit';

const router = Router();

router.use(authenticate);

router.get('/', validate(listInventorySchema), inventoryController.list);
router.get('/low-stock', inventoryController.lowStock);

// ─── §2.4 Clearance management (Owner only; never editable at POS) ───
// List flagged articles, bulk set flag+price, and remove from clearance.
router.get('/clearance', authorize('owner'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const variants = await prisma.productVariant.findMany({
      where: { clearanceFlag: true },
      include: { product: { select: { name: true, mrp: true, basePrice: true } } },
      orderBy: { id: 'desc' },
    });
    res.json({
      success: true,
      data: variants.map((v) => ({
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        productName: v.product.name,
        mrp: v.product.mrp ?? v.product.basePrice,
        clearancePrice: v.clearancePrice,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/clearance', authorize('owner'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = req.body.items as { variantId: number; clearancePrice: number }[];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items[] is required' });
    }
    for (const it of items) {
      if (!(Number(it.clearancePrice) > 0)) {
        return res.status(400).json({ success: false, error: 'clearancePrice must be greater than 0' });
      }
      await prisma.productVariant.update({
        where: { id: it.variantId },
        data: { clearanceFlag: true, clearancePrice: it.clearancePrice },
      });
    }
    await recordAudit(prisma, {
      action: 'variant.clearanceSet',
      entityType: 'productVariant',
      entityId: items.length === 1 ? items[0].variantId : null,
      userId: req.user!.userId,
      branchId: req.user!.branchId,
      data: { count: items.length },
    });
    res.json({ success: true, data: { updated: items.length }, message: 'Clearance applied' });
  } catch (e) {
    next(e);
  }
});

router.delete('/clearance/:variantId', authorize('owner'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.variantId, 10);
    await prisma.productVariant.update({
      where: { id },
      data: { clearanceFlag: false, clearancePrice: null },
    });
    await recordAudit(prisma, {
      action: 'variant.clearanceRemoved',
      entityType: 'productVariant',
      entityId: id,
      userId: req.user!.userId,
      branchId: req.user!.branchId,
    });
    res.json({ success: true, message: 'Removed from clearance' });
  } catch (e) {
    next(e);
  }
});
router.post(
  '/adjust',
  authorize('owner', 'manager'),
  validate(adjustStockSchema),
  inventoryController.adjust
);
router.post(
  '/restock',
  authorize('owner', 'manager'),
  validate(restockSchema),
  inventoryController.restock
);
router.get('/transfer', inventoryController.listTransfers);
router.post(
  '/transfer',
  authorize('owner', 'manager'),
  validate(createTransferSchema),
  inventoryController.createTransfer
);
router.put(
  '/transfer/:id/approve',
  authorize('owner', 'manager'),
  validate(transferParamsSchema),
  inventoryController.approveTransfer
);
router.put(
  '/transfer/:id/receive',
  authorize('owner', 'manager'),
  validate(transferParamsSchema),
  inventoryController.receiveTransfer
);
router.get('/movements', validate(listMovementsSchema), inventoryController.movements);
router.put(
  '/movements/:id',
  authorize('owner', 'manager'),
  validate(updateMovementSchema),
  inventoryController.updateMovement
);

// Import
router.get('/import/template', inventoryController.importTemplate);
router.post(
  '/import/preview',
  authorize('owner', 'manager'),
  upload.single('file'),
  inventoryController.importPreview
);
router.post(
  '/import/execute',
  authorize('owner', 'manager'),
  inventoryController.importExecute
);

export default router;
