import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as brandService from './service';

export const listBrands = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { brands, meta } = await brandService.listBrands(req.query as any);
    res.json({ success: true, data: brands, meta });
  } catch (error) {
    next(error);
  }
};

export const getBrandById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brand = await brandService.getBrandById(parseInt(req.params.id, 10));
    res.json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const createBrand = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brand = await brandService.createBrand(req.body);
    res.status(201).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const updateBrand = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const brand = await brandService.updateBrand(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const deleteBrand = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await brandService.deleteBrand(parseInt(req.params.id, 10));
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
