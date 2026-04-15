import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { customerService } from './service';

export class CustomerController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await customerService.list(req.query as any);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async topCustomers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await customerService.topCustomers(req.query as any);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.getById(parseInt(req.params.id));
      res.json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.create(req.body);
      res.status(201).json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.update(parseInt(req.params.id), req.body);
      res.json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }

  async getPurchaseHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await customerService.getPurchaseHistory(
        parseInt(req.params.id),
        req.query as any
      );
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getLoyaltyHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await customerService.getLoyaltyHistory(
        parseInt(req.params.id),
        req.query as any
      );
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const customerController = new CustomerController();
