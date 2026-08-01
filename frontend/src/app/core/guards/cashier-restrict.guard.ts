import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Billing-staff restriction. `cashier` and `staff` are POS/returns-only logins:
 * they may only bill, return and exchange. Only `owner`/`manager` see the rest
 * of the app. This keeps the UI honest by bouncing billing roles out of every
 * other section.
 *
 * Used as canActivateChild on the MainLayout parent so it re-runs on EVERY
 * navigation to a child (including sibling → sibling, which a parent
 * canActivate would miss). It sees the full target URL for any child
 * (dashboard, inventory, reports, employees, settings, …). POS and mobile-POS
 * are separate top-level routes and are never blocked here. Sales is allowed
 * because returns/exchanges are processed from a sale's detail page.
 */
const BILLING_ONLY_ROLES = ['cashier', 'staff'];

export const cashierRestrictGuard: CanActivateChildFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const role = auth.getCurrentUser()?.role;
  if (!role || !BILLING_ONLY_ROLES.includes(role)) return true;

  const allowed = ['/sales', '/pos', '/mobile-pos'];
  if (allowed.some((p) => state.url.startsWith(p))) return true;

  router.navigate(['/pos']);
  return false;
};
