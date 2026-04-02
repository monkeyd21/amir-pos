import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as branchService from './service';

export const listBranches = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const branches = await branchService.listBranches();
    res.json({ success: true, data: branches });
  } catch (error) {
    next(error);
  }
};

export const getBranchById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const branch = await branchService.getBranchById(parseInt(req.params.id, 10));
    res.json({ success: true, data: branch });
  } catch (error) {
    next(error);
  }
};

export const createBranch = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const branch = await branchService.createBranch(req.body);
    res.status(201).json({ success: true, data: branch });
  } catch (error) {
    next(error);
  }
};

export const updateBranch = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const branch = await branchService.updateBranch(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: branch });
  } catch (error) {
    next(error);
  }
};

export const deleteBranch = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await branchService.deleteBranch(parseInt(req.params.id, 10));
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
