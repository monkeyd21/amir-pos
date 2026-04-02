# Agent 1: Backend Core Modules

## Your Task
Build the backend API modules for: **Auth, Users, Branches, Brands, Categories, Products, Barcodes**

## Tech Stack
- Node.js + Express + TypeScript
- Prisma ORM (schema already defined in `backend/prisma/schema.prisma`)
- Zod for validation
- JWT for auth (middleware in `backend/src/middleware/auth.ts`)

## Existing Code
- Prisma schema: `backend/prisma/schema.prisma` — READ THIS FIRST
- Auth middleware: `backend/src/middleware/auth.ts` (authenticate, authorize)
- Validation middleware: `backend/src/middleware/validate.ts`
- Error handling: `backend/src/middleware/errorHandler.ts` (AppError class)
- Helpers: `backend/src/utils/helpers.ts` (generateEAN13, generateSKU, slugify, getPagination, buildPaginationMeta)
- Config: `backend/src/config/index.ts`
- Database: `backend/src/config/database.ts` (exports prisma instance)
- Shared enums: `shared/src/enums/index.ts`
- App entry: `backend/src/app.ts` — routes already imported, DON'T modify this file

## Module Pattern
Each module folder gets 4 files:
```
modules/{name}/
  ├── routes.ts      — Express router with route definitions
  ├── controller.ts  — Request handlers (thin, delegates to service)
  ├── service.ts     — Business logic, Prisma queries
  └── validators.ts  — Zod schemas for request validation
```

## Modules to Build

### 1. Auth Module (`modules/auth/`)
- POST /login — email + password login, returns JWT access + refresh tokens
- POST /refresh — refresh token rotation
- POST /change-password — authenticated, requires old password
- Use bcryptjs for password hashing
- JWT payload: { userId, email, role, branchId }

### 2. Users Module (`modules/users/`)
- GET / — list users (paginated, filterable by branch/role)
- GET /:id — get user by id
- GET /me — get current authenticated user
- POST / — create user (owner/manager only)
- PUT /:id — update user
- DELETE /:id — soft delete (set isActive = false)
- Password must be hashed on create

### 3. Branches Module (`modules/branches/`)
- Full CRUD for branches
- GET / — list all active branches
- POST / — create branch (owner only)
- PUT /:id — update branch
- DELETE /:id — soft delete

### 4. Brands Module (`modules/brands/`)
- Full CRUD
- Auto-generate slug from name using slugify helper
- GET / — list with search/filter
- POST / — create (manager+)
- PUT /:id — update
- DELETE /:id — soft delete

### 5. Categories Module (`modules/categories/`)
- Full CRUD with parent/child tree support
- GET / — list as flat or tree structure
- POST / — create with optional parentId
- PUT /:id — update
- DELETE /:id — soft delete

### 6. Products Module (`modules/products/`)
- GET / — list products with variants, brand, category (paginated, filterable by brand/category/size/color)
- GET /:id — single product with all variants
- POST / — create product
- PUT /:id — update product
- DELETE /:id — soft delete
- POST /:id/variants — add variant (auto-generate SKU and barcode using helpers)
- PUT /:id/variants/:variantId — update variant
- DELETE /:id/variants/:variantId — soft delete variant

### 7. Barcodes Module (`modules/barcodes/`)
- GET /lookup/:barcode — lookup product variant by barcode (used by POS scanner)
- POST /generate — generate barcode for a variant
- POST /print-batch — accept array of variant IDs, return barcode data for printing

## Important Notes
- ALL routes except auth/login require authentication middleware
- Use `authorize('owner', 'manager')` for admin-only routes
- Return consistent API response format: `{ success: boolean, data?: T, message?: string, error?: string, meta?: pagination }`
- Use the `validate()` middleware with Zod schemas
- Import prisma from `../../config/database`
- Import AppError from `../../middleware/errorHandler`
- Import helpers from `../../utils/helpers`
- Use try/catch in controllers, pass errors to next()
