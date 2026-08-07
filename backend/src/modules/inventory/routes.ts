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
  reconcileStockSchema,
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
      include: {
        product: { select: { name: true, mrp: true, basePrice: true, costPrice: true } },
        inventory: { select: { quantity: true } },
      },
      // §Clearance — most-recently-flagged first ("recent first"). updatedAt is
      // bumped whenever clearanceFlag is set (see POST below), so a just-added
      // article surfaces at the top instead of sorting by variant id, which has
      // nothing to do with when it was put on clearance. id desc is a deterministic
      // tiebreaker for the pre-existing backlog, which shares one updatedAt from
      // the column's backfill (all tied until each is next re-flagged/edited).
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    // §Clearance — a flagged article stays in the ACTIVE list while there is
    // still something to clear. We do NOT gate purely on Inventory.quantity > 0:
    // much legacy dead stock is recorded on-hand 0 (or has no Inventory row) yet
    // is physically held and was never sold — gating on stock alone silently hid
    // those freshly-flagged articles. Instead an article drops OFF the active
    // list only once it is BOTH sold-through on clearance AND out of stock; it
    // then lives solely in the Sold Articles tab (previously such sold-out
    // articles wrongly showed in BOTH lists). Stock stays as an info column.
    const flaggedIds = variants.map((v) => v.id);
    const clearanceSales = flaggedIds.length
      ? await prisma.saleItem.findMany({
          where: { isClearance: true, variantId: { in: flaggedIds }, sale: { status: 'completed' } },
          select: { variantId: true, quantity: true, returnedQuantity: true },
        })
      : [];
    // Net units actually sold on clearance per variant (gross − returned),
    // matching the Sold tab's definition.
    const soldNet = new Map<number, number>();
    for (const si of clearanceSales) {
      soldNet.set(
        si.variantId,
        (soldNet.get(si.variantId) ?? 0) + ((si.quantity ?? 0) - (si.returnedQuantity ?? 0))
      );
    }

    res.json({
      success: true,
      data: variants
        .map((v) => ({
          variantId: v.id,
          sku: v.sku,
          barcode: v.barcode,
          size: v.size,
          color: v.color,
          productName: v.product.name,
          mrp: v.product.mrp ?? v.product.basePrice,
          // §Clearance — surface the purchase (cost) price so the owner can see
          // the margin left after clearance. Per-variant override wins over the
          // product-level cost.
          purchasePrice: v.costOverride ?? v.product.costPrice,
          clearancePrice: v.clearancePrice,
          stock: v.inventory.reduce((s, inv) => s + (inv.quantity ?? 0), 0),
        }))
        // Sold-through on clearance AND out of stock → belongs only in the Sold tab.
        .filter((r) => !((soldNet.get(r.variantId) ?? 0) > 0 && r.stock <= 0)),
    });
  } catch (e) {
    next(e);
  }
});

// §Clearance — "Sold Articles" tab. Lists clearance articles that have actually
// been SOLD, i.e. any variant that appears on a SaleItem flagged isClearance=true
// (the persisted snapshot taken at checkout — it survives even if the variant
// later leaves clearance). We aggregate net quantity sold (gross − returned) per
// variant and carry the distinct bill numbers/dates. Registered before
// `/clearance/:variantId` so "sold" is never parsed as a :variantId param.
router.get('/clearance/sold', authorize('owner'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const soldItems = await prisma.saleItem.findMany({
      where: { isClearance: true, sale: { status: 'completed' } },
      include: {
        variant: {
          include: {
            product: { select: { name: true, mrp: true, basePrice: true, costPrice: true } },
          },
        },
        sale: { select: { saleNumber: true, createdAt: true, businessDate: true } },
      },
      orderBy: { id: 'desc' },
    });

    // Group by variant. quantitySold is net of returns; the fixed clearance
    // price on a clearance line is stored in SaleItem.unitPrice, and the struck
    // MRP snapshot in SaleItem.mrp (fall back to the live variant/product MRP).
    const byVariant = new Map<number, any>();
    for (const it of soldItems) {
      const vid = it.variantId;
      let row = byVariant.get(vid);
      if (!row) {
        const v = it.variant;
        row = {
          variantId: vid,
          sku: v.sku,
          barcode: v.barcode,
          size: v.size,
          color: v.color,
          productName: v.product.name,
          mrp: it.mrp ?? v.mrpOverride ?? v.product.mrp ?? v.product.basePrice,
          clearancePrice: it.unitPrice ?? v.clearancePrice,
          purchasePrice: v.costOverride ?? v.product.costPrice,
          quantitySold: 0,
          stillOnClearance: v.clearanceFlag,
          sales: [] as { saleNumber: string; date: Date }[],
        };
        byVariant.set(vid, row);
      }
      row.quantitySold += (it.quantity ?? 0) - (it.returnedQuantity ?? 0);
      const date = it.sale.businessDate ?? it.sale.createdAt;
      if (!row.sales.some((s: any) => s.saleNumber === it.sale.saleNumber)) {
        row.sales.push({ saleNumber: it.sale.saleNumber, date });
      }
    }

    const data = Array.from(byVariant.values())
      // Only meaningful "sold" rows (a fully-refunded line nets to zero).
      .filter((r) => r.quantitySold > 0);

    res.json({ success: true, data });
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
  '/reconcile',
  authorize('owner', 'manager'),
  validate(reconcileStockSchema),
  inventoryController.reconcile
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
