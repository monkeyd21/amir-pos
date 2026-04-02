import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as authService from './service';

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const result = await authService.changePassword(req.user!.userId, oldPassword, newPassword);
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
