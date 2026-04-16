import { Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthRequest } from '../../middleware/auth';
import { salesService } from './service';
import { buildReceiptPdf } from './receipt-pdf';

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
      const param = req.params.id;
      const sale = /^\d+$/.test(param)
        ? await salesService.getSaleById(parseInt(param))
        : await salesService.getSaleBySaleNumber(param);
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

  /**
   * Returns a PDF of the receipt. Used by the mobile POS share intent to
   * attach the bill to a WhatsApp message (or any share target).
   */
  async receiptPdf(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id, 10);
      const sale = await prisma.sale.findUnique({
        where: { id },
        include: {
          branch: true,
          customer: true,
          user: { select: { firstName: true, lastName: true } },
          items: {
            include: {
              variant: { include: { product: true } },
            },
          },
          payments: true,
        },
      });
      if (!sale) throw new AppError('Sale not found', 404);

      const pdf = await buildReceiptPdf(sale as any);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="receipt-${sale.saleNumber}.pdf"`
      );
      res.send(pdf);
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

  async assignAgents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const saleId = parseInt(req.params.saleId, 10);
      const result = await salesService.assignAgents(saleId, req.body);
      res.json({ success: true, data: result, message: 'Agents assigned' });
    } catch (error) {
      next(error);
    }
  }
}

export const salesController = new SalesController();
