import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * Shared mock for the Prisma client.
 * Every module imports `prisma` from '../../config/database'.
 * We intercept that import and provide a deeply-mocked object that jest can
 * control on a per-test basis via `mockReturnValue` / `mockResolvedValue`.
 */

// ---------------------------------------------------------------------------
// Generic recursive mock builder
// ---------------------------------------------------------------------------
type DeepMockProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? jest.Mock
    : DeepMockProxy<T[K]>;
} & { [key: string]: any };

function buildPrismaMock(): any {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') return undefined; // prevent promise-like coercion
      if (prop === '$transaction') {
        // $transaction receives a callback, we invoke it with the same proxy
        // so `tx.model.method()` calls resolve to the same mocks.
        return jest.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => {
          return cb(prismaMock);
        });
      }
      if (typeof prop === 'symbol') return undefined;

      // Lazily create nested mocks so prisma.user.findUnique etc. are all jest.fn()
      if (!_target[prop]) {
        _target[prop] = new Proxy(Object.assign(jest.fn(), {}), handler);
      }
      return _target[prop];
    },
  };

  return new Proxy({} as any, handler);
}

export const prismaMock = buildPrismaMock();

// Mock the database module using the path relative to THIS file (src/__tests__/setup.ts).
// jest.mock resolves paths relative to the file that calls it.
// From src/__tests__/ -> src/config/database is ../config/database
jest.mock('../config/database', () => ({
  __esModule: true,
  default: prismaMock,
}));

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
