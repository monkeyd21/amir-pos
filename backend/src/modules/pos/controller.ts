import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { posService } from './service';

export class PosController {
  async openSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await posService.openSession(
        req.user!.userId,
        req.user!.branchId,
        req.body.openingAmount,
        req.body.notes
      );
      res.status(201).json({
        success: true,
        data: session,
        message: 'POS session opened',
      });
    } catch (error) {
      next(error);
    }
  }

  async closeSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.finalizeCloseSession(
        req.user!.userId,
        req.body.closingAmount,
        req.body.notes
      );
      res.json({
        success: true,
        data: result,
        message: 'POS session closed',
      });
    } catch (error) {
      next(error);
    }
  }

  async currentSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await posService.getCurrentSession(req.user!.userId);
      res.json({ success: true, data: session });
    } catch (error) {
      next(error);
    }
  }

  async checkout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.checkout(
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({
        success: true,
        data: result.sale,
        change: result.change,
        message: 'Sale completed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async searchProducts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const query = (req.query.q || req.query.query || '') as string;
      const results = await posService.searchProducts(query, req.user!.branchId);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }

  async lookupBarcode(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const variant = await posService.lookupBarcode(
        req.params.barcode,
        req.user!.branchId
      );
      res.json({ success: true, data: variant });
    } catch (error) {
      next(error);
    }
  }

  async holdCart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const held = await posService.holdCart(
        req.user!.userId,
        req.user!.branchId,
        req.body.cartData,
        req.body.customerId,
        req.body.notes
      );
      res.status(201).json({
        success: true,
        data: held,
        message: 'Cart held successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async listHeld(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const held = await posService.listHeld(req.user!.branchId);
      res.json({ success: true, data: held });
    } catch (error) {
      next(error);
    }
  }

  async deleteHeld(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await posService.deleteHeld(parseInt(req.params.id));
      res.json({ success: true, message: 'Held transaction deleted' });
    } catch (error) {
      next(error);
    }
  }

  async resumeHeld(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const held = await posService.resumeHeld(parseInt(req.params.id));
      res.json({
        success: true,
        data: held,
        message: 'Held transaction resumed',
      });
    } catch (error) {
      next(error);
    }
  }
  async createUpiPayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.createUpiPayment(
        req.body, req.user!.userId, req.user!.branchId
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  async checkUpiPaymentStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.checkUpiPaymentStatus(
        req.params.intentId, req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  async handlePaymentWebhook(req: Request, res: Response) {
    try {
      await posService.handleUpiWebhook(
        req.headers as Record<string, string>,
        req.body.toString()
      );
    } catch (error) {
      console.error('Webhook error:', error);
    }
    res.json({ success: true }); // Always 200 to ACK
  }
}

export const posController = new PosController();
