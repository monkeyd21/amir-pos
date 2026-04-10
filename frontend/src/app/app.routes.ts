import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadChildren: () =>
      import('./modules/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./modules/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'inventory',
        loadChildren: () =>
          import('./modules/inventory/inventory.routes').then((m) => m.INVENTORY_ROUTES),
      },
      {
        path: 'sales',
        loadChildren: () =>
          import('./modules/sales/sales.routes').then((m) => m.SALES_ROUTES),
      },
      {
        path: 'offers',
        loadChildren: () =>
          import('./modules/offers/offers.routes').then((m) => m.OFFERS_ROUTES),
      },
      {
        path: 'customers',
        loadChildren: () =>
          import('./modules/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
      },
      {
        path: 'employees',
        loadChildren: () =>
          import('./modules/employees/employees.routes').then((m) => m.EMPLOYEES_ROUTES),
      },
      {
        path: 'expenses',
        loadChildren: () =>
          import('./modules/expenses/expenses.routes').then((m) => m.EXPENSES_ROUTES),
      },
      {
        path: 'accounting',
        loadChildren: () =>
          import('./modules/accounting/accounting.routes').then((m) => m.ACCOUNTING_ROUTES),
      },
      {
        path: 'reports',
        loadChildren: () =>
          import('./modules/reports/reports.routes').then((m) => m.REPORTS_ROUTES),
      },
      {
        path: 'settings',
        loadChildren: () =>
          import('./modules/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
    ],
  },
  {
    path: 'pos',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./modules/pos/pos.routes').then((m) => m.POS_ROUTES),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
