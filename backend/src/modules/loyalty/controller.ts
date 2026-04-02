import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { loyaltyService } from './service';

export class LoyaltyController {
  async getConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const config = await loyaltyService.getConfig();
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  async updateConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const config = await loyaltyService.updateConfig(req.body);
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  async earnPoints(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await loyaltyService.earnPoints(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async redeemPoints(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await loyaltyService.redeemPoints(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async adjustPoints(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await loyaltyService.adjustPoints(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const loyaltyController = new LoyaltyController();
