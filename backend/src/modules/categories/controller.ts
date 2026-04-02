import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as categoryService from './service';

export const listCategories = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const categories = await categoryService.listCategories(req.query as any);
    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

export const getCategoryById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const category = await categoryService.getCategoryById(parseInt(req.params.id, 10));
    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const category = await categoryService.createCategory(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const category = await categoryService.updateCategory(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await categoryService.deleteCategory(parseInt(req.params.id, 10));
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
