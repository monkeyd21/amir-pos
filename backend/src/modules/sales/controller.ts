import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { salesService } from './service';

export class SalesController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.listSales(req.query as any, req.user!.branchId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const sale = await salesService.getSaleById(parseInt(req.params.id));
      res.json({ success: true, data: sale });
    } catch (error) {
      next(error);
    }
  }

  async receipt(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const receiptData = await salesService.getReceiptData(parseInt(req.params.id));
      res.json({ success: true, data: receiptData });
    } catch (error) {
      next(error);
    }
  }

  async processReturn(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.processReturn(
        parseInt(req.params.saleId),
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({
        success: true,
        data: result.returnRecord,
        refundAmount: result.refundAmount,
        message: 'Return processed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async processExchange(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.processExchange(
        parseInt(req.params.saleId),
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const salesController = new SalesController();
