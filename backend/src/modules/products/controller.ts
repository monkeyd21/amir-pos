import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as productService from './service';

export const listProducts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { products, meta } = await productService.listProducts(req.query as any);
    res.json({ success: true, data: products, meta });
  } catch (error) {
    next(error);
  }
};

export const getProductById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const product = await productService.getProductById(parseInt(req.params.id, 10));
    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const product = await productService.createProduct(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const product = await productService.updateProduct(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await productService.deleteProduct(parseInt(req.params.id, 10));
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};

export const addVariant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const variant = await productService.addVariant(parseInt(req.params.id, 10), req.body);
    res.status(201).json({ success: true, data: variant });
  } catch (error) {
    next(error);
  }
};

export const updateVariant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const variant = await productService.updateVariant(
      parseInt(req.params.id, 10),
      parseInt(req.params.variantId, 10),
      req.body,
    );
    res.json({ success: true, data: variant });
  } catch (error) {
    next(error);
  }
};

export const deleteVariant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await productService.deleteVariant(
      parseInt(req.params.id, 10),
      parseInt(req.params.variantId, 10),
    );
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
