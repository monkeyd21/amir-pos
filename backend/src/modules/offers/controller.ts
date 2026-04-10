import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as offerService from './service';

export class OffersController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await offerService.listOffers(req.query as any);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await offerService.getOffer(parseInt(req.params.id, 10));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await offerService.createOffer(req.body);
      res.status(201).json({ success: true, data, message: 'Offer created' });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await offerService.updateOffer(
        parseInt(req.params.id, 10),
        req.body
      );
      res.json({ success: true, data, message: 'Offer updated' });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await offerService.deleteOffer(parseInt(req.params.id, 10));
      res.json({ success: true, data, message: 'Offer removed' });
    } catch (error) {
      next(error);
    }
  }

  async setAssignments(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await offerService.setAssignments(
        parseInt(req.params.id, 10),
        req.body.productIds ?? [],
        req.body.variantIds ?? []
      );
      res.json({ success: true, data, message: 'Assignments updated' });
    } catch (error) {
      next(error);
    }
  }
}

export const offersController = new OffersController();
