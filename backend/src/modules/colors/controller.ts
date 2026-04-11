import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as colorService from './service';

export const listColors = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const colors = await colorService.listColors();
    res.json({ success: true, data: colors });
  } catch (error) {
    next(error);
  }
};

export const createColor = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const color = await colorService.createColor(req.body);
    res.status(201).json({ success: true, data: color });
  } catch (error) {
    next(error);
  }
};
