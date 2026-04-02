import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { messagingService } from './service';

export class MessagingController {
  async sendBill(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await messagingService.sendBill(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async sendCustom(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await messagingService.sendCustomMessage(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async listLogs(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await messagingService.listLogs(req.query as any);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const messagingController = new MessagingController();
