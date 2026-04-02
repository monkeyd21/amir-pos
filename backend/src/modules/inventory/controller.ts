import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { inventoryService } from './service';

export class InventoryController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inventoryService.listInventory(
        req.query as any,
        req.user!.branchId
      );
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
      next(error);
    }
  }

  async lowStock(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const branchId = req.query.branchId
        ? parseInt(req.query.branchId as string)
        : req.user!.branchId;
      const data = await inventoryService.getLowStock(branchId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async adjust(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inventoryService.adjustStock(req.body, req.user!.userId);
      res.status(201).json({
        success: true,
        data: result,
        message: 'Stock adjusted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async createTransfer(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const transfer = await inventoryService.createTransfer(req.body, req.user!.userId);
      res.status(201).json({
        success: true,
        data: transfer,
        message: 'Stock transfer created',
      });
    } catch (error) {
      next(error);
    }
  }

  async approveTransfer(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const transfer = await inventoryService.approveTransfer(
        parseInt(req.params.id),
        req.user!.userId
      );
      res.json({
        success: true,
        data: transfer,
        message: 'Transfer approved and dispatched',
      });
    } catch (error) {
      next(error);
    }
  }

  async receiveTransfer(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const transfer = await inventoryService.receiveTransfer(
        parseInt(req.params.id),
        req.user!.userId
      );
      res.json({
        success: true,
        data: transfer,
        message: 'Transfer received successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async movements(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inventoryService.listMovements(
        req.query as any,
        req.user!.branchId
      );
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
      next(error);
    }
  }
}

export const inventoryController = new InventoryController();
