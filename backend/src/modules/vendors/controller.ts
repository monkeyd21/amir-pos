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

export const getVendorLedger = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await vendorService.getVendorLedger(parseInt(req.params.id, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const recordPayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payment = await vendorService.recordVendorPayment({
      vendorId: parseInt(req.params.id, 10),
      amount: req.body.amount,
      method: req.body.method,
      reference: req.body.reference,
      notes: req.body.notes,
      paymentDate: req.body.paymentDate,
      createdBy: req.user!.userId,
    });
    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};
