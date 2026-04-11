import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as vendorService from './service';

export const listVendors = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { vendors, meta } = await vendorService.listVendors(req.query as any);
    res.json({ success: true, data: vendors, meta });
  } catch (error) {
    next(error);
  }
};

export const getVendorById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await vendorService.getVendorById(parseInt(req.params.id, 10));
    res.json({ success: true, data: vendor });
  } catch (error) {
    next(error);
  }
};

export const createVendor = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await vendorService.createVendor(req.body);
    res.status(201).json({ success: true, data: vendor });
  } catch (error) {
    next(error);
  }
};

export const updateVendor = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await vendorService.updateVendor(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: vendor });
  } catch (error) {
    next(error);
  }
};

export const deleteVendor = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await vendorService.deleteVendor(parseInt(req.params.id, 10));
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
