import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as sizeService from './service';

export const listSizes = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Settings/management passes ?all=1 to see inactive sizes too; pickers omit it.
    const includeInactive = req.query.all === '1' || req.query.all === 'true';
    const sizes = await sizeService.listSizes({ includeInactive });
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

export const updateSize = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const size = await sizeService.updateSize(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: size });
  } catch (error) {
    next(error);
  }
};

export const deleteSize = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await sizeService.deleteSize(parseInt(req.params.id, 10));
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const reorderSizes = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sizes = await sizeService.reorderSizes(req.body.ids);
    res.json({ success: true, data: sizes });
  } catch (error) {
    next(error);
  }
};
