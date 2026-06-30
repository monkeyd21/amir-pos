import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30000,
  retries: 1,
  // One worker: the whole suite runs against a single shared backend + Postgres
  // and one admin POS session. Parallel POS checkouts would interfere, so keep
  // it serial for deterministic runs.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4200',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'cd backend && export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" && npm run dev',
      port: 3000,
      reuseExistingServer: true,
    },
    {
      command: 'cd frontend && export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" && npx ng serve',
      port: 4200,
      reuseExistingServer: true,
    },
  ],
});
