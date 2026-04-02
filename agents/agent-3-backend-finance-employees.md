# Agent 3: Backend Finance, Employees, Customers, Loyalty, Messaging

## Your Task
Build the backend API modules for: **Customers, Loyalty, Expenses, Accounting, Employees, Messaging, Reports**

## Tech Stack
- Node.js + Express + TypeScript
- Prisma ORM (schema in `backend/prisma/schema.prisma`)
- Zod for validation

## Existing Code — READ THESE FIRST
- Prisma schema: `backend/prisma/schema.prisma`
- Auth middleware: `backend/src/middleware/auth.ts` (authenticate, authorize, AuthRequest)
- Validation: `backend/src/middleware/validate.ts`
- Error: `backend/src/middleware/errorHandler.ts` (AppError)
- Helpers: `backend/src/utils/helpers.ts`
- Database: `backend/src/config/database.ts` (prisma instance)
- Config: `backend/src/config/index.ts` (whatsapp, sms config)
- App: `backend/src/app.ts` — routes already imported, DON'T modify

## Module Pattern
```
modules/{name}/
  ├── routes.ts
  ├── controller.ts
  ├── service.ts
  └── validators.ts
```

## Modules to Build

### 1. Customers Module (`modules/customers/`)
- GET / — list customers (paginated, searchable by name/phone)
- GET /:id — customer detail with recent purchase history
- POST / — create customer (phone is unique)
- PUT /:id — update customer
- GET /:id/history — full purchase history (sales list)
- GET /:id/loyalty — loyalty transaction history

### 2. Loyalty Module (`modules/loyalty/`)
- GET /config — get current loyalty configuration
- PUT /config — update loyalty config (owner only)
- POST /earn — award points to customer (called internally by POS, but also manual)
  - Calculate points: (saleTotal / amountPerPoint) * tierMultiplier
- POST /redeem — redeem points (validate sufficient balance)
  - Deduct points, return discount value
- POST /adjust — manual point adjustment (manager+, with reason)
- Auto-upgrade tier: after each earn, check if customer qualifies for next tier

### 3. Expenses Module (`modules/expenses/`)
- GET / — list expenses (paginated, filterable by branch/category/status/date range)
- GET /:id — expense detail
- POST / — create expense
- PUT /:id — update expense (only if pending)
- PUT /:id/approve — approve expense (manager+)
- PUT /:id/reject — reject expense (manager+)
- GET /categories — list expense categories
- POST /categories — create expense category
- PUT /categories/:id — update category
- GET /summary — expense summary by category for date range

### 4. Accounting Module (`modules/accounting/`)
- GET /accounts — chart of accounts (tree structure)
- POST /accounts — create account
- PUT /accounts/:id — update account
- GET /journal-entries — list journal entries (filterable by branch/date range)
- POST /journal-entries — create manual journal entry
  - Validate: total debits MUST equal total credits
  - Accept: { branchId, date, description, lines: [{accountId, debit, credit, description}] }
- GET /ledger — general ledger view (account balances for date range)
  - For each account: opening balance, total debits, total credits, closing balance
- GET /pnl — Profit & Loss statement
  - Revenue accounts minus Expense accounts for date range
  - Group by account, show subtotals per type
- GET /trial-balance — trial balance report

Also create a utility `modules/accounting/autoJournal.ts`:
- Function to auto-create journal entries from sales (DR Cash/Bank, CR Revenue, CR Tax Payable)
- Function to auto-create journal entries from expenses (DR Expense Account, CR Cash/Bank)
- These will be called by POS and Expense modules

### 5. Employees Module (`modules/employees/`)
- POST /attendance/clock-in — clock in (validate no duplicate for today)
- POST /attendance/clock-out — clock out (calculate hoursWorked)
- GET /attendance — list attendance (filterable by user/branch/date range)
- GET /attendance/summary — monthly summary per employee
- GET /commissions — list commissions (filterable by user/status/date range)
- GET /commissions/calculate — calculate commissions for a pay period
  - For each employee with sales: sum(sale.total * employee.commissionRate)
  - Create Commission records
- PUT /commissions/:id/pay — mark commission as paid (owner/manager)
- GET /commissions/summary — commission summary per employee for period

### 6. Messaging Module (`modules/messaging/`)
- POST /send-bill — send bill/receipt via WhatsApp or SMS
  - Accept: { saleId, customerId, type: 'whatsapp' | 'sms' }
  - For WhatsApp: call Meta Cloud API to send template message with bill details
  - For SMS: use configured SMS provider
  - Log in message_logs table
- GET /logs — list message logs (filterable by customer/type/status)
- POST /send-custom — send custom message to customer

WhatsApp integration (`modules/messaging/whatsapp.ts`):
```typescript
// Use Meta Cloud API
// POST https://graph.facebook.com/v18.0/{phone-number-id}/messages
// Headers: Authorization: Bearer {access-token}
// Body: { messaging_product: "whatsapp", to: phone, type: "template", template: {...} }
```

### 7. Reports Module (`modules/reports/`)
- GET /sales — sales report (by date range, branch, product, brand)
  - Daily/weekly/monthly aggregation
  - Include: total sales, total items, avg transaction value, top products
- GET /inventory — inventory report
  - Stock levels, slow-moving items, stock value per branch
- GET /customers — customer report
  - New customers, repeat rate, top customers by spend, tier distribution
- GET /commissions — commission report per employee for period
- GET /pnl — P&L report (delegate to accounting service)
- GET /daily-summary — quick daily summary for dashboard
  - Today's sales, returns, expenses, net revenue per branch

All reports should support `?format=json` (default) and `?format=csv` for export.

## Important Notes
- Use Prisma transactions for any multi-step operations
- Double-entry accounting: every journal entry must balance (total debits = total credits)
- Loyalty points: always validate before redeem, never go negative
- WhatsApp/SMS: gracefully handle provider failures, log status
- Reports: use Prisma aggregation (groupBy, aggregate) for performance
