import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Billing-staff restriction. A `cashier` is a POS/returns-only login: the
 * backend already limits them to checkout + return + exchange, and this keeps
 * the UI honest by bouncing them out of every other section.
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

  const role = auth.getCurrentUser()?.role;
  if (role !== 'cashier') return true;

  const allowed = ['/sales', '/pos', '/mobile-pos'];
  if (allowed.some((p) => state.url.startsWith(p))) return true;

  router.navigate(['/pos']);
  return false;
};
