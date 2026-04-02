import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as userService from './service';

export const listUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { users, meta } = await userService.listUsers(req.query as any);
    res.json({ success: true, data: users, meta });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await userService.getUserById(req.user!.userId);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await userService.getUserById(parseInt(req.params.id, 10));
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await userService.updateUser(parseInt(req.params.id, 10), req.body);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await userService.deleteUser(parseInt(req.params.id, 10));
    res.json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
};
