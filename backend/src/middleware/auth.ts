import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    email: string;
    role: string;
    branchId: number;
  };
}

export const authenticate = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as AuthRequest['user'];
    if (decoded) applyBranchOverride(req, decoded);
    req.user = decoded;
    next();
  } catch {
    return next(new AppError('Invalid or expired token', 401));
  }
};

// Owners can switch branches via the X-Branch-Id header — used by the branch
// switcher UI. Other roles are pinned to their JWT branch to prevent a cashier
// from peeking at another store's data by spoofing a header.
function applyBranchOverride(
  req: AuthRequest,
  user: NonNullable<AuthRequest['user']>
): void {
  if (user.role !== 'owner') return;
  const raw = req.headers['x-branch-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return;
  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  user.branchId = parsed;
}

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};
