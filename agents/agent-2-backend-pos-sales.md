# Agent 2: Backend POS, Sales, Payments, Returns, Inventory

## Your Task
Build the backend API modules for: **Inventory, POS, Sales, Payments, Returns**

## Tech Stack
- Node.js + Express + TypeScript
- Prisma ORM (schema already defined in `backend/prisma/schema.prisma`)
- Zod for validation
- JWT for auth

## Existing Code — READ THESE FIRST
- Prisma schema: `backend/prisma/schema.prisma`
- Auth middleware: `backend/src/middleware/auth.ts` (authenticate, authorize, AuthRequest)
- Validation middleware: `backend/src/middleware/validate.ts`
- Error handling: `backend/src/middleware/errorHandler.ts` (AppError class)
- Helpers: `backend/src/utils/helpers.ts` (generateNumber, getPagination, buildPaginationMeta)
- Database: `backend/src/config/database.ts` (exports prisma)
- App entry: `backend/src/app.ts` — routes already imported, DON'T modify

## Module Pattern
Each module folder gets 4 files:
```
modules/{name}/
  ├── routes.ts
  ├── controller.ts
  ├── service.ts
  └── validators.ts
```

## Modules to Build

### 1. Inventory Module (`modules/inventory/`)
- GET / — list inventory by branch (filterable by variant, low stock flag)
- GET /low-stock — variants below minStockLevel for a branch
- POST /adjust — adjust stock (increase/decrease) with reason, creates InventoryMovement
- POST /transfer — create stock transfer between branches
- PUT /transfer/:id/approve — approve transfer (manager+)
- PUT /transfer/:id/receive — mark transfer received, update quantities
- GET /movements — list inventory movements (filterable by variant/branch/type/date range)

### 2. POS Module (`modules/pos/`)
- POST /sessions/open — open cash register (opening amount required)
- POST /sessions/close — close register (closing amount, auto-calculate expected)
- GET /sessions/current — get current open session for user
- POST /checkout — THE MAIN POS ENDPOINT:
  - Accept: { items: [{barcode, quantity}], customerId?, payments: [{method, amount, referenceNumber?}], discountAmount?, loyaltyPointsRedeem? }
  - Validate: all barcodes exist, sufficient stock, payments cover total
  - Create Sale + SaleItems + Payments in a transaction
  - Deduct inventory (create InventoryMovements with type=sale)
  - If customer: update visitCount, totalSpent, earn loyalty points
  - Generate saleNumber using generateNumber('SL')
  - Return complete sale with items and payments
- POST /hold — hold a cart (save as HeldTransaction with cartData JSON)
- GET /held — list held transactions for branch
- DELETE /held/:id — delete held transaction
- POST /held/:id/resume — return held transaction data and delete it

### 3. Sales Module (`modules/sales/`)
- GET / — list sales (paginated, filterable by branch/date range/status/customer)
- GET /:id — single sale with items, payments, customer, return info
- GET /:id/receipt — return formatted receipt data (for printing)

### 4. Payments Module (`modules/payments/`)
- POST / — record a payment against a sale
- POST /:id/refund — refund a payment (mark as refunded)
- GET /summary — daily payment summary by method for a branch

### 5. Returns Module (combine into `modules/sales/` as return endpoints)
- POST /:saleId/return — process return:
  - Accept: { items: [{saleItemId, quantity, condition}], reason }
  - Validate: quantities don't exceed original - already returned
  - Create Return + ReturnItems in transaction
  - Update SaleItem.returnedQuantity
  - If condition=resellable, restock inventory (InventoryMovement type=return)
  - Update Sale status (returned/partially_returned)
  - Generate returnNumber using generateNumber('RT')
- POST /:saleId/exchange — process exchange:
  - Accept: { returnItems: [{saleItemId, quantity, condition}], newItems: [{barcode, quantity}] }
  - Process return for old items
  - Process sale for new items
  - Calculate price difference, return payment info

## Critical Business Logic
- POS checkout MUST use Prisma transactions ($transaction) to ensure atomicity
- Stock can never go negative — validate before deducting
- All inventory changes must create InventoryMovement records for audit trail
- Payment amounts must sum to sale total (or more for cash with change)
- Returns: update Sale status to 'partially_returned' if some items returned, 'returned' if all returned

## Response Format
`{ success: boolean, data?: T, message?: string, error?: string, meta?: pagination }`
