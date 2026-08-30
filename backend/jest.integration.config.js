/**
 * Integration tests — real Postgres, no mocked Prisma.
 *
 * The unit suite (jest.config.js) mocks the database, which is right for
 * business logic but useless for the reservation engine: the thing under test
 * there IS the locking behaviour. These run against a live database.
 *
 *   createdb shop_test
 *   SHOP_TEST_DATABASE_URL=postgresql://user@localhost:5432/shop_test \
 *     npx jest -c jest.integration.config.js
 *
 * Without SHOP_TEST_DATABASE_URL the suites skip rather than fail, so a plain
 * `npm test` on a machine with no database still passes.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__integration__/**/*.test.ts'],
  clearMocks: true,
  testTimeout: 30000,
  // Deliberately NO setupFiles — the point is a real Prisma client.
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: false }],
  },
};
