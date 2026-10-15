import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Billing-staff restriction. `supervisor`, `cashier` and `staff` are billing
 * logins: they bill, return and exchange, and see the dashboard trimmed to
 * their role (dashboard spec §11A, enforced again by the API). Only
 * `owner`/`manager` see the rest of the app. This keeps the UI honest by bouncing billing roles out of every
 * other section.
 *
 * Used as canActivateChild on the MainLayout parent so it re-runs on EVERY
 * navigation to a child (including sibling → sibling, which a parent
 * canActivate would miss). It sees the full target URL for any child
 * (dashboard, inventory, reports, employees, settings, …). POS and mobile-POS
 * are separate top-level routes and are never blocked here. Sales is allowed
 * because returns/exchanges are processed from a sale's detail page.
 */
export const cashierRestrictGuard: CanActivateChildFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isBillingRole()) return true;

  const allowed = ['/dashboard', '/sales', '/pos', '/mobile-pos'];
  if (allowed.some((p) => state.url.startsWith(p))) return true;

  router.navigate(['/pos']);
  return false;
};
