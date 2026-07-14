import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as sizeService from './service';

export const listSizes = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sizes = await sizeService.listSizes();
    res.json({ success: true, data: sizes });
  } catch (error) {
    next(error);
  }
};

export const createSize = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const size = await sizeService.createSize(req.body);
    res.status(201).json({ success: true, data: size });
  } catch (error) {
    next(error);
  }
};
