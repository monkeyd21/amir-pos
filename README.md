# ClothingERP

A full-stack retail clothing ERP system for managing inventory, point-of-sale, sales, customers, employees, expenses, and accounting across multiple branches.

## Features

- **Point of Sale** — Barcode scanning, cart management, cash/card checkout, hold & resume transactions, receipt generation (PDF)
- **Inventory** — Product catalog with variants (size/color), stock levels per branch, stock transfers, barcode management
- **Sales** — Sales history, returns (partial/full), exchanges, sale detail view
- **Customers** — Customer directory, loyalty points tracking
- **Employees** — Employee management, attendance tracking, sales commissions
- **Expenses** — Expense recording and categorization
- **Accounting** — Journal entries, chart of accounts
- **Multi-branch** — Branch-level inventory, user assignment, POS sessions per branch
- **Dashboard** — KPI cards, sales charts, top products, low stock alerts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 17, Angular Material, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL with Prisma ORM |
| Auth | JWT (bcrypt password hashing) |
| Validation | Zod schemas |
| PDF | PDFKit (receipts) |
| Testing | Jest (backend), Playwright (E2E) |
| Monorepo | npm workspaces |

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm 9+

## Setup

```bash
# Clone the repo
git clone <repo-url> && cd clothing-erp

# Install dependencies (all workspaces)
npm install

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your DATABASE_URL and JWT_SECRET

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed demo data
npm run db:seed
```

## Running

```bash
# Start both backend (port 3000) and frontend (port 4200)
npm run dev

# Or run individually
npm run dev:backend    # Express API on http://localhost:3000
npm run dev:frontend   # Angular dev server on http://localhost:4200
```

## Testing

### Backend unit tests
```bash
cd backend && npx jest --verbose
```

### E2E tests (requires running app + seeded database)
```bash
npx playwright test
```

### Interactive demo walkthrough
```bash
npx playwright test e2e/demo.spec.ts --headed --workers=1
```

## Project Structure

```
clothing-erp/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema
│   │   └── seed.ts            # Demo data seeder
│   └── src/
│       ├── modules/           # Feature modules
│       │   ├── pos/           #   POS terminal
│       │   ├── sales/         #   Sales & returns
│       │   ├── inventory/     #   Stock management
│       │   ├── products/      #   Product catalog
│       │   ├── customers/     #   Customer directory
│       │   ├── employees/     #   Employee management
│       │   ├── expenses/      #   Expense tracking
│       │   ├── accounting/    #   Journal entries
│       │   ├── auth/          #   Authentication
│       │   ├── branches/      #   Multi-branch
│       │   ├── brands/        #   Brand management
│       │   ├── categories/    #   Product categories
│       │   ├── barcodes/      #   Barcode generation
│       │   ├── loyalty/       #   Loyalty program
│       │   ├── messaging/     #   Notifications
│       │   ├── payments/      #   Payment processing
│       │   ├── reports/       #   Reporting
│       │   └── users/         #   User management
│       ├── config/            # App & DB config
│       ├── middleware/        # Auth, validation, error handling
│       └── __tests__/         # Test setup & mocks
├── frontend/
│   └── src/app/
│       ├── modules/           # Angular feature modules
│       │   ├── dashboard/     #   KPI cards, charts
│       │   ├── pos/           #   POS terminal UI
│       │   ├── inventory/     #   Products, stock, transfers
│       │   ├── sales/         #   Sales list & detail
│       │   ├── customers/     #   Customer CRUD
│       │   ├── employees/     #   Employees, attendance, commissions
│       │   ├── expenses/      #   Expense management
│       │   ├── accounting/    #   Accounting views
│       │   ├── auth/          #   Login page
│       │   ├── reports/       #   Reports
│       │   └── settings/      #   App settings
│       └── shared/            # Shared components & services
├── shared/                    # Shared TypeScript types
├── e2e/                       # Playwright E2E tests
└── CLAUDE.md                  # AI agent instructions
```

## User Roles

| Role | Permissions |
|------|------------|
| **Owner** | Full access to all modules and settings |
| **Manager** | Branch management, inventory, reports, employee management |
| **Cashier** | POS terminal, sales view |
| **Staff** | Limited access based on assignment |

## API

All endpoints are prefixed with `/api`. Responses use a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

Authentication is via Bearer token in the `Authorization` header.

## License

Private — All rights reserved.
