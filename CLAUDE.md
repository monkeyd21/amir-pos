# ClothingERP - Agent Instructions

## Project Overview
Full-stack Clothing ERP system with:
- **Backend**: Node.js + Express + Prisma ORM + PostgreSQL (port 3000)
- **Frontend**: Angular 17 + Angular Material (port 4200)
- **Shared**: TypeScript types in `shared/` package
- **Monorepo** managed with npm workspaces

## Quick Start
```bash
npm install                    # Install all workspaces
cd backend && npx prisma generate  # Generate Prisma client
cd backend && npx prisma db seed   # Seed demo data (if needed)
npm run dev                    # Start both backend + frontend
```

## Running Tests

### Backend Unit Tests (Jest + mocked Prisma)
```bash
cd backend && npx jest --verbose
```
- Jest config: `backend/jest.config.js` (JS, not TS — the .ts was deleted)
- Mock setup: `backend/src/__tests__/mockDatabase.ts` (loaded via `setupFiles`)
- Test helper: `backend/src/__tests__/setup.ts` (exports `prismaMock`, JWT helpers)
- Tests use `supertest` against the Express app with mocked Prisma
- 7 module test suites: branches, brands, categories, customers, employees, expenses, users
- 1 more in sales: `backend/src/modules/sales/__tests__/sales.test.ts`

### E2E Tests (Playwright)
```bash
npx playwright test                          # Run all E2E
npx playwright test e2e/auth.spec.ts         # Run specific suite
npx playwright test --headed --workers=1     # Watch mode
npx playwright test e2e/demo.spec.ts --headed --workers=1  # Interactive demo
```
- Config: `playwright.config.ts`
- Helper: `e2e/helpers.ts` (login function)
- Suites: auth, dashboard, inventory, pos, settings, demo
- **Requires**: backend running on port 3000, frontend on port 4200, seeded database

## What Was Being Worked On (interrupted by power cut)

### Completed Work (uncommitted - now being committed)
1. **Backend POS barcode lookup endpoint** — `GET /api/pos/lookup/:barcode`
   - `backend/src/modules/pos/service.ts` — `lookupBarcode()` method
   - `backend/src/modules/pos/controller.ts` — `lookupBarcode()` handler
   - `backend/src/modules/pos/routes.ts` — route registration

2. **Jest config migration** — moved from `jest.config.ts` to `jest.config.js`
   - Created `backend/src/__tests__/mockDatabase.ts` (setupFiles-based mock)
   - Updated `backend/src/__tests__/setup.ts` to use global prismaMock

3. **7 new backend unit test suites** (~1,288 lines total):
   - branches, brands, categories, customers, employees, expenses, users

4. **E2E test fixes** — updated selectors for auth, dashboard, inventory, pos, settings
   - Fixed flaky selectors (text matches → h1 filters, better timeouts)
   - Fixed POS barcodes to use valid seeded data
   - Relaxed assertions that depended on specific mock states

5. **Interactive demo spec** — `e2e/demo.spec.ts` walks through all modules

6. **Demo screenshots** — `demo-screenshots/` (captured during headed runs)

### What Still Needs To Be Done
1. **Run Playwright E2E tests end-to-end** — power went out mid-run, need to verify all pass
   ```bash
   # Start the app first, then:
   npx playwright test
   ```

2. **Run backend Jest tests** — verify all pass after the mock refactor
   ```bash
   cd backend && npx jest --verbose
   ```

3. **Fix any failing tests** — some E2E tests may still have flaky selectors or timing issues

4. **POS checkout flow** — the checkout E2E test uses a relaxed assertion (checks for snackbar rather than specific success message). If POS session management is working correctly, tighten this back up.

5. **Demo screenshots** — if the demo spec passes, screenshots will be in `demo-screenshots/`. Capture fresh ones if needed.

## Key Architecture Notes
- API responses use envelope: `{ success: true, data: ..., meta: ... }`
- Auth: JWT tokens, login via `POST /api/auth/login`
- Default test credentials: `admin@clothingerp.com` / `admin123` (check seed)
- Sidebar navigation uses `app-sidebar a[href="/path"]` pattern
- Angular Material components throughout (mat-table, mat-dialog, mat-tab, etc.)
- POS barcode input: `input[placeholder="Scan or type barcode..."]`

## Project Structure
```
backend/
  src/
    modules/          # Feature modules (pos, sales, inventory, etc.)
      {module}/
        controller.ts
        service.ts
        routes.ts
        __tests__/    # Jest unit tests
    __tests__/
      setup.ts        # Test setup (prismaMock export, JWT helpers)
      mockDatabase.ts # Prisma mock (setupFiles)
    config/
      database.ts     # Prisma client export
  prisma/
    schema.prisma
    seed.ts
frontend/
  src/app/
    modules/          # Angular feature modules
    shared/           # Shared components, services
e2e/                  # Playwright E2E tests
shared/               # Shared TypeScript types
```
