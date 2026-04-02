# Agent 4: Frontend Shell, Layout, Auth, Dashboard, and Core Services

## Your Task
Set up the Angular frontend application with: **App shell, Layout, Auth module, Dashboard, Core services, and Shared components**

## Tech Stack
- Angular 17+ (standalone components)
- Angular Material
- Tailwind CSS
- TypeScript

## IMPORTANT: Project Setup
The frontend directory exists but is empty. You need to:

1. Initialize Angular app using Angular CLI:
```bash
cd /home/imran/projects/clothing-erp
npx @angular/cli@17 new frontend --directory=frontend --routing=true --style=scss --ssr=false --standalone=true --skip-git=true
```

2. Install dependencies:
```bash
cd frontend
npm install @angular/material @angular/cdk
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

3. Set up Tailwind in `tailwind.config.js` and `src/styles.scss`

## Design System — Clean Sonic UI
- **Colors**: Primary blue (#2563EB), neutral grays, white backgrounds
- **Typography**: Inter or system font stack, clean hierarchy
- **Spacing**: Generous whitespace, 8px grid system
- **Components**: Subtle shadows, rounded corners (8px), smooth transitions
- **Sidebar**: Dark sidebar (#1E293B) with light text, collapsible
- **Cards**: White cards with subtle border, no heavy shadows

## What to Build

### 1. Core Module (`src/app/core/`)

**Services:**
- `api.service.ts` — HTTP client wrapper with base URL, auth headers, error handling
  - Methods: get<T>, post<T>, put<T>, delete<T>
  - Auto-attach JWT from localStorage
  - Handle 401 → redirect to login
- `auth.service.ts` — login, logout, refresh, getCurrentUser, isAuthenticated
  - Store tokens in localStorage
  - Decode JWT for user info
- `branch.service.ts` — getBranches, getCurrentBranch, switchBranch
  - Store selected branch in localStorage
- `notification.service.ts` — success/error/warning toast notifications using MatSnackBar

**Guards:**
- `auth.guard.ts` — redirect to /login if not authenticated
- `role.guard.ts` — check user role for route access

**Interceptors:**
- `auth.interceptor.ts` — attach Authorization header
- `error.interceptor.ts` — handle HTTP errors globally

### 2. Layout (`src/app/layout/`)
- `main-layout/` — the app shell with sidebar + header + content area
- `sidebar/` — navigation sidebar:
  - Logo at top
  - Nav items grouped: Dashboard, POS, Inventory (Products, Stock, Barcodes), Sales, Customers, Employees, Expenses, Accounting, Reports, Settings
  - Each item: icon + label, collapsible groups
  - Active state highlighting
  - Collapse toggle button
- `header/` — top header bar:
  - Branch selector dropdown (switch between branches)
  - Search bar (global search)
  - User avatar + dropdown (profile, logout)
  - Notifications bell

### 3. Auth Module (`src/app/modules/auth/`)
- `login/` — Login page:
  - Clean centered card with logo
  - Email + password form with validation
  - "Remember me" checkbox
  - Submit → call auth service → redirect to dashboard
  - Error display for invalid credentials
- Route: `/login` (no layout wrapper)

### 4. Dashboard Module (`src/app/modules/dashboard/`)
- `dashboard/` — main dashboard page:
  - **KPI Cards row**: Today's Sales, Today's Revenue, Total Customers, Low Stock Items
  - **Sales Chart**: Line/bar chart for last 7 days sales (use a simple chart — can use ng2-charts or just styled divs for now)
  - **Recent Sales Table**: Last 10 transactions
  - **Low Stock Alerts**: Products below minimum stock
  - **Top Products**: Best sellers today/this week
- Route: `/dashboard`

### 5. Shared Module (`src/app/shared/`)

**Components:**
- `data-table/` — reusable table with sorting, pagination, search
  - Uses Angular Material table
  - Input: columns config, data, pagination config
  - Output: page change, sort change, row click
- `confirm-dialog/` — confirmation dialog (are you sure?)
- `page-header/` — page title + breadcrumbs + action buttons
- `status-badge/` — colored badge for statuses (completed=green, pending=yellow, etc.)
- `loading-spinner/` — centered spinner
- `empty-state/` — "no data" illustration with message
- `search-input/` — debounced search input with icon
- `date-range-picker/` — date range selection using Material datepicker
- `currency.pipe.ts` — format numbers as currency (INR)

### 6. Routing (`src/app/app.routes.ts`)
```typescript
// Lazy-loaded modules:
/ → redirect to /dashboard
/login → AuthModule (no layout)
/dashboard → DashboardModule (with layout)
/pos → PosModule (full-screen, no sidebar)
/inventory → InventoryModule (with layout)
/sales → SalesModule (with layout)
/customers → CustomersModule (with layout)
/employees → EmployeesModule (with layout)
/expenses → ExpensesModule (with layout)
/accounting → AccountingModule (with layout)
/reports → ReportsModule (with layout)
/settings → SettingsModule (with layout)
```

### 7. Environments
- `environment.ts` — `apiUrl: 'http://localhost:3000/api/v1'`
- `environment.prod.ts` — `apiUrl: '/api/v1'`

## Styling Notes
- Use Angular Material theming with custom blue palette
- Tailwind for layout (flex, grid, spacing, responsive)
- SCSS for component-specific styles
- Dark sidebar, light content area
- Responsive: sidebar collapses to icons on tablet, hamburger on mobile
- POS screen: full viewport, no sidebar

## File to NOT modify
- Don't touch anything in `backend/` or `shared/` directories
