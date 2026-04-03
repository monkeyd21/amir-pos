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
npx ts-node prisma/seed.ts    # Seed demo data (if needed)
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
- 14 test suites, 178 tests total
- Modules tested: branches, brands, categories, customers, employees, expenses, users, sales, pos, auth, accounting, inventory, products, utils

### E2E Tests (Playwright)
```bash
npx playwright install                       # First time: install browsers
npx playwright test                          # Run all E2E
npx playwright test e2e/auth.spec.ts         # Run specific suite
npx playwright test --headed --workers=1     # Watch mode
npx playwright test e2e/demo.spec.ts --headed --workers=1  # Interactive demo
```
- Config: `playwright.config.ts`
- Helper: `e2e/helpers.ts` (login function)
- Suites: auth, dashboard, inventory, pos, settings, sales, customers, employees, demo
- **Requires**: backend running on port 3000, frontend on port 4200, seeded database
- **Note**: E2E tests may need selector updates after recent UI changes

## Key Architecture Notes
- API responses use envelope: `{ success: true, data: ..., meta: ... }`
- Backend error responses: `{ success: false, error: "message" }` (note: `error` field, not `message`)
- Auth: JWT tokens (15min access, 7d refresh), login via `POST /api/v1/auth/login`
- Default credentials: `admin@clothingerp.com` / `admin123`
- Auth interceptor attaches `Authorization` header and `X-Branch-Id` header (must be string, not number)
- Error interceptor reads `error.error?.error || error.error?.message` for API error messages
- Sidebar navigation uses `app-sidebar a[href="/path"]` pattern
- Angular Material components throughout (mat-table, mat-dialog, mat-tab, etc.)
- POS auto-opens a session on load if none exists
- Sale detail supports lookup by numeric ID or sale number string (e.g. `/sales/SL-XXX`)
- Status display: use `formatStatus()` method, NOT `| titlecase` pipe (handles `partially_returned` → "Partially Returned")

## Common Frontend-Backend Field Mapping Issues
When displaying sale items, inventory, or any data with product variants, the API returns **nested** structures:
- `item.variant.product.name` (not `item.productName`)
- `item.variant.size` / `item.variant.color` (not `item.size`)
- `sale.user.firstName + ' ' + sale.user.lastName` (not `sale.cashierName`)
- `sale.customer.firstName + ' ' + sale.customer.lastName` (not `sale.customerName`)

Always use fallbacks: `item.variant?.product?.name || item.productName || item.name`

## Frontend Service → Backend Route Mapping
| Frontend Service | Backend Route |
|---|---|
| `/inventory` | `GET /api/v1/inventory` (not `/inventory/stock`) |
| `/inventory/adjust` | `POST /api/v1/inventory/adjust` (not `/adjustments`) |
| `/inventory/transfer` | `GET/POST /api/v1/inventory/transfer` (not `/transfers`) |
| `/sales/:id/return` | `POST /api/v1/sales/:saleId/return` (not `/returns`) |
| `/customers/search` | `GET /api/v1/customers/search?query=X` |
| `/pos/products/search` | `GET /api/v1/pos/products/search?q=X` |
| `/pos/sessions/current` | Returns `null` (not 404) when no session |

## What Was Completed (Session: 2026-04-03)

### Bugs Fixed
1. **Login broken** — `HttpHeaders.set()` requires string for `X-Branch-Id`, was passing number
2. **Double route** — `/login/login` → fixed auth routes to single `/login`
3. **Dashboard fake data** — replaced hardcoded KPIs with real API data from `/reports/daily-summary`, `/sales`, `/customers`, `/inventory`
4. **POS checkout failing** — auto-open POS session on terminal load, `getCurrentSession` returns null instead of 404
5. **Customer search** — added `/search` route, accept `query` param alias
6. **Sale detail empty fields** — fixed nested data mapping for product/variant/cashier/customer
7. **Stock levels empty** — fixed endpoint path and field name mapping (`minStockLevel`, nested `variant.product.name`)
8. **Returns endpoint** — frontend called `/returns`, backend has `/return`
9. **Error messages** — interceptor now reads `error.error?.error` (backend's field name)
10. **Status formatting** — `partially_returned` → "Partially Returned" with orange color, no more `| titlecase` on underscore strings

### Features Added
1. **Profile page** — `/settings/profile` with personal info editing and password change
2. **POS product search** — autocomplete by product name in barcode input, `GET /pos/products/search?q=X`
3. **Barcode management** — product lookup by name/barcode, print queue with scannable Code128 barcodes (JsBarcode), `@media print` sticker layout
4. **Sale lookup by sale number** — `GET /sales/SL-XXX` works alongside numeric ID
5. **Stock transfer listing** — `GET /inventory/transfer` endpoint
6. **Return/Exchange dialogs** — show product name + variant, filter out already-returned items, barcode lookup for exchange new items
7. **Sale detail returns section** — shows return history with items, reason, condition, refund amount
8. **Returned column** — items table shows returned quantity badges

### Data Seeded
- 8 brands (Levis, Nike, Zara, Allen Solly, Peter England, Van Heusen, Raymond, Biba)
- 9 categories (Men, Women, Shirts, Jeans, Dresses, T-Shirts, Trousers, Kurtas, Jackets)
- 10 products with ~75 variants
- 12 customers
- 25+ sales with mix of cash/card/UPI payments

### What Still Needs Work
1. **E2E tests** — need selector updates after UI changes (dashboard, sales list, return dialog, etc.)
2. **Settings page** — still a placeholder (profile page is done)
3. **Reports module** — placeholder
4. **Accounting module** — basic journal entries exist but UI needs work
5. **Receipt printing** — backend has receipt data endpoint but no frontend UI
6. **Expense management** — UI exists but needs testing with real data
7. **Employee attendance/commission** — backend models exist, no frontend

## Project Structure
```
backend/
  src/
    modules/          # Feature modules (pos, sales, inventory, etc.)
      {module}/
        controller.ts
        service.ts
        routes.ts
        validators.ts
        __tests__/    # Jest unit tests
    __tests__/
      setup.ts        # Test setup (prismaMock export, JWT helpers)
      mockDatabase.ts # Prisma mock (setupFiles)
    config/
      database.ts     # Prisma client export
    core/
      interceptors/   # auth.interceptor.ts, error.interceptor.ts
  prisma/
    schema.prisma
    seed.ts
frontend/
  src/app/
    modules/          # Angular feature modules
      auth/           # Login
      dashboard/      # KPI cards, charts, recent sales
      sales/          # Sales list, detail, return/exchange dialogs
      pos/            # POS terminal with barcode/product search
      inventory/      # Products, stock levels, transfers, barcodes
      customers/      # Customer list, detail
      employees/      # Employee management
      expenses/       # Expense tracking
      accounting/     # Journal entries
      settings/       # Profile page
    shared/           # Shared components (status-badge, page-header, etc.)
    core/services/    # ApiService, AuthService, BranchService, NotificationService
e2e/                  # Playwright E2E tests
shared/               # Shared TypeScript types
```
