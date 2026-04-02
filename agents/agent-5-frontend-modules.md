# Agent 5: Frontend Feature Modules — POS, Inventory, Sales, Customers, Employees, Expenses, Accounting, Reports, Settings

## Your Task
Build ALL feature modules for the Angular frontend. Agent 4 is building the shell/layout/auth/dashboard/shared components. You build everything else.

## IMPORTANT: Dependencies
Agent 4 creates the Angular project and shared components. You should work in the same frontend directory. If the project isn't set up yet, set it up first using:
```bash
cd /home/imran/projects/clothing-erp/frontend
# If node_modules doesn't exist, run: npm install
```

## Tech Stack
- Angular 17+ (standalone components)
- Angular Material components
- Tailwind CSS for layout
- TypeScript strict mode

## Design Principles (Sonic UI)
- Clean, minimal, professional
- White cards on light gray (#F8FAFC) background
- Blue accent (#2563EB), consistent rounded corners
- Good use of whitespace, clear visual hierarchy
- Tables: zebra striping, hover effect, action buttons
- Forms: clear labels, inline validation, two-column layout where appropriate
- Modals for quick actions, full pages for complex forms

## Modules to Build

### 1. POS Module (`src/app/modules/pos/`) — MOST IMPORTANT
**Route: `/pos`** — Full-screen, no sidebar

**POS Terminal Screen:**
- **Left panel (60%)**: Cart/item list
  - Barcode scan input at top (auto-focus, large font)
  - Scanned items table: product name, variant (size/color), qty, unit price, total
  - Inline quantity adjustment (+/- buttons)
  - Remove item button
  - Running subtotal, tax, discount, total at bottom
- **Right panel (40%)**: Actions
  - Customer search/select (search by phone/name)
  - Quick customer add form
  - Discount input (flat or %)
  - Loyalty points display (if customer selected) + redeem toggle
  - **Payment section**:
    - Amount due display
    - Payment method tabs: Cash | Card | UPI
    - Amount input per method (support split payment)
    - Cash: show change calculation
    - Card/UPI: reference number input
  - Action buttons: Hold, Checkout, Clear Cart
- **Held transactions panel**: slide-out with list of held carts

**Services:**
- `pos.service.ts` — checkout, hold, resume, getSession, openSession, closeSession

### 2. Inventory Module (`src/app/modules/inventory/`)
**Routes: `/inventory`, `/inventory/products`, `/inventory/stock`, `/inventory/transfers`, `/inventory/barcodes`**

**Sub-pages:**
- **Products** (`/inventory/products`):
  - Products list table with filters (brand, category, search)
  - Product detail/edit dialog or page
  - Add product form with variant management (add multiple size/color combos)
  - Variant list with barcode display
- **Stock** (`/inventory/stock`):
  - Stock levels table: product, variant, branch, quantity, min level, status
  - Filter by branch, low stock toggle
  - Stock adjustment dialog: select variant, +/- quantity, reason
- **Transfers** (`/inventory/transfers`):
  - Transfer list with status badges
  - Create transfer wizard: select from/to branch → add items → submit
  - Transfer detail with approve/receive actions
- **Barcodes** (`/inventory/barcodes`):
  - Barcode lookup by scan/manual input
  - Bulk barcode print: select products/variants → generate printable barcode sheet
  - Use JsBarcode library for barcode rendering

**Services:**
- `product.service.ts`, `inventory.service.ts`, `barcode.service.ts`

### 3. Sales Module (`src/app/modules/sales/`)
**Routes: `/sales`, `/sales/:id`**

- **Sales list**: table with date, sale#, customer, total, status, payment method
  - Filters: date range, status, branch, customer search
- **Sale detail page**:
  - Sale info header (number, date, cashier, customer, status)
  - Items table with quantities and prices
  - Payment breakdown
  - Return/exchange action buttons
- **Return dialog**:
  - Select items to return with quantities
  - Condition selector per item (resellable/damaged)
  - Reason input
  - Refund amount calculation
  - Submit → process return
- **Exchange dialog**:
  - Select items to return
  - Scan/select new items
  - Show price difference
  - Submit → process exchange

### 4. Customers Module (`src/app/modules/customers/`)
**Routes: `/customers`, `/customers/:id`**

- **Customer list**: searchable table (name, phone, email, tier, points, total spent)
- **Customer detail page**:
  - Profile card: name, phone, email, address
  - Loyalty card: tier badge, points balance, tier progress bar
  - Purchase history tab: sales table
  - Loyalty transactions tab: points earned/redeemed history
- **Add/edit customer dialog**: form with validation (phone required, unique)

### 5. Employees Module (`src/app/modules/employees/`)
**Routes: `/employees`, `/employees/attendance`, `/employees/commissions`**

- **Employee list**: table (name, role, branch, commission rate, status)
- **Add/edit employee**: form with role selector, branch assignment, commission rate
- **Attendance page**:
  - Calendar/table view of attendance records
  - Clock in/out buttons for current user
  - Monthly summary per employee
- **Commissions page**:
  - Commission list table (employee, period, amount, status)
  - Calculate commissions button for a pay period
  - Pay commission action (mark as paid)
  - Summary cards per employee

### 6. Expenses Module (`src/app/modules/expenses/`)
**Routes: `/expenses`**

- **Expense list**: table with filters (category, status, date range, branch)
- **Add expense form**: category, amount, date, description, payment method, receipt upload
- **Expense detail**: view with approve/reject actions (for manager+)
- **Category management**: inline CRUD for expense categories

### 7. Accounting Module (`src/app/modules/accounting/`)
**Routes: `/accounting/ledger`, `/accounting/journal`, `/accounting/pnl`**

- **General Ledger**:
  - Account tree/list view
  - Click account → show transactions (journal lines) for date range
  - Opening balance, debits, credits, closing balance per account
- **Journal Entries**:
  - List of journal entries with date, description, total
  - Create journal entry form: date, description, multiple debit/credit lines
  - Validation: debits must equal credits (show running difference)
- **P&L Statement**:
  - Date range selector
  - Revenue section: grouped by account
  - Expense section: grouped by account
  - Net profit/loss calculation
  - Print/export button

### 8. Reports Module (`src/app/modules/reports/`)
**Routes: `/reports`**

- **Tabbed interface** with these report types:
  - Sales Report: date range, by branch/product/brand, with chart
  - Inventory Report: stock levels, value, slow-moving items
  - Customer Report: new/repeat, tier distribution, top spenders
  - Commission Report: by employee, by period
  - P&L Report: redirect to accounting P&L
- **Each report**: date range picker, filters, data table, summary cards
- **Export buttons**: CSV download, PDF print

### 9. Settings Module (`src/app/modules/settings/`)
**Routes: `/settings`**

- **Tabs**:
  - General: app name, currency, default tax rate
  - Branches: branch management (CRUD)
  - Users: user management (CRUD, role assignment)
  - Loyalty: loyalty config (points per amount, tier thresholds)
  - Tax: tax rate configuration per category

## Services Pattern
Each module has its own service that calls the backend API:
```typescript
@Injectable({ providedIn: 'root' })
export class ProductService {
  private api = inject(ApiService);

  getAll(params?: any) { return this.api.get<ApiResponse>('/products', { params }); }
  getById(id: number) { return this.api.get<ApiResponse>(`/products/${id}`); }
  create(data: any) { return this.api.post<ApiResponse>('/products', data); }
  update(id: number, data: any) { return this.api.put<ApiResponse>(`/products/${id}`, data); }
  delete(id: number) { return this.api.delete<ApiResponse>(`/products/${id}`); }
}
```

## Important Notes
- Use Angular standalone components (not NgModules)
- Lazy-load all feature modules via routes
- Use Angular Material for tables, forms, dialogs, tabs, menus
- Use Tailwind for layout and spacing
- Use reactive forms with validation
- Handle loading/error states in all components
- The `ApiService` from core handles auth headers and base URL
