import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { paymentsService } from './service';

export class PaymentsController {
  async recordPayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const payment = await paymentsService.recordPayment(req.body);
      res.status(201).json({
        success: true,
        data: payment,
        message: 'Payment recorded successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async refundPayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const payment = await paymentsService.refundPayment(parseInt(req.params.id));
      res.json({
        success: true,
        data: payment,
        message: 'Payment refunded successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async summary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const branchId = req.query.branchId
        ? parseInt(req.query.branchId as string)
        : req.user!.branchId;
      const date = req.query.date as string | undefined;
      const summaryData = await paymentsService.getDailySummary(branchId, date);
      res.json({ success: true, data: summaryData });
    } catch (error) {
      next(error);
    }
  }
}

export const paymentsController = new PaymentsController();
