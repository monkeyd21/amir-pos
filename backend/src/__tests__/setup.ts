import jwt from 'jsonwebtoken';
import { config } from '../config';

// The prismaMock is created in mockDatabase.ts (loaded via jest setupFiles)
// and stored on the global object.
export const prismaMock: any = (global as any).__prismaMock__;

// ---------------------------------------------------------------------------
// JWT helpers for authenticated requests
// ---------------------------------------------------------------------------
export interface MockUser {
  userId: number;
  email: string;
  role: string;
  branchId: number;
}

export const testUsers = {
  owner: {
    userId: 1,
    email: 'owner@test.com',
    role: 'owner',
    branchId: 1,
  } as MockUser,
  manager: {
    userId: 2,
    email: 'manager@test.com',
    role: 'manager',
    branchId: 1,
  } as MockUser,
  cashier: {
    userId: 3,
    email: 'cashier@test.com',
    role: 'cashier',
    branchId: 1,
  } as MockUser,
};

export function generateToken(user: MockUser): string {
  return jwt.sign(user, config.jwt.secret, { expiresIn: '1h' });
}

export function generateRefreshToken(user: MockUser): string {
  return jwt.sign(user, config.jwt.refreshSecret, { expiresIn: '7d' });
}

export function authHeader(user: MockUser): string {
  return `Bearer ${generateToken(user)}`;
}
