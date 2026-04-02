import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as barcodeService from './service';

export const lookupByBarcode = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const variant = await barcodeService.lookupByBarcode(req.params.barcode);
    res.json({ success: true, data: variant });
  } catch (error) {
    next(error);
  }
};

export const generateBarcode = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await barcodeService.generateBarcode(req.body.variantId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const printBatch = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const barcodeData = await barcodeService.printBatch(req.body.variantIds);
    res.json({ success: true, data: barcodeData });
  } catch (error) {
    next(error);
  }
};
