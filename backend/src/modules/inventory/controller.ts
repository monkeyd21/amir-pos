import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { inventoryService } from './service';
import {
  parseExcelBuffer,
  executeImport,
  generateTemplateBuffer,
  ImportRow,
} from './importer';

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

  async restock(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inventoryService.restock(
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({
        success: true,
        data: result,
        message: `Restocked ${result.variantsRestocked} variant(s) — ${result.totalUnitsAdded} units added`,
      });
    } catch (error) {
      next(error);
    }
  }

  async listTransfers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inventoryService.listTransfers(req.query as any, req.user!.branchId);
      res.json({ success: true, data: result.data, meta: result.meta });
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

  async updateMovement(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const movement = await inventoryService.updateMovement(
        parseInt(req.params.id),
        req.body
      );
      res.json({
        success: true,
        data: movement,
        message: 'Movement updated',
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

  // ─── Import ──────────────────────────────────────────────

  async importPreview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }
      const result = parseExcelBuffer(req.file.buffer);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async importExecute(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const rows: ImportRow[] = req.body.rows;
      if (!rows || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'No rows to import' });
      }
      const result = await executeImport(
        rows,
        req.user!.branchId,
        req.user!.userId
      );
      res.json({
        success: true,
        data: result,
        message: `Import complete: ${result.productsCreated} products created, ${result.variantsCreated} variants created, ${result.inventoryUpdated} stock records updated`,
      });
    } catch (error) {
      next(error);
    }
  }

  async importTemplate(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const buffer = generateTemplateBuffer();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="inventory-import-template.xlsx"'
      );
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
}

export const inventoryController = new InventoryController();
