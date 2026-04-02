// This file is loaded via jest setupFiles to mock the database before any test module loads.
// Creates a Proxy-based mock that auto-creates jest.fn() for any prisma.model.method() call.

// Build a proxy that auto-creates jest.fn() for nested property access.
// prisma.user.findUnique() → prismaMock.user is a sub-proxy, .findUnique is a jest.fn()
function buildModelProxy(): any {
  return new Proxy({} as any, {
    get(target, prop) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'symbol') return undefined;
      if (!target[prop]) {
        target[prop] = jest.fn();
      }
      return target[prop];
    },
  });
}

const models: Record<string, any> = {};

const prismaMock = new Proxy({} as any, {
  get(target, prop) {
    if (prop === 'then') return undefined;
    if (typeof prop === 'symbol') return undefined;
    if (prop === '$transaction') {
      if (!target._$transaction) {
        target._$transaction = jest.fn().mockImplementation(
          async (cb: (tx: any) => Promise<any>) => cb(prismaMock)
        );
      }
      return target._$transaction;
    }
    if (!models[prop as string]) {
      models[prop as string] = buildModelProxy();
    }
    return models[prop as string];
  },
});

// Make prismaMock available globally for test files to import
(global as any).__prismaMock__ = prismaMock;

jest.mock('../config/database', () => ({
  __esModule: true,
  default: prismaMock,
}));
