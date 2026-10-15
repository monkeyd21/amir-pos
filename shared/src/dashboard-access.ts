/**
 * Dashboard spec §11A: who sees what on the dashboard.
 *
 * In `shared/` because two readers must agree: the API, which leaves out what a
 * role may not see (hiding it in the browser alone would still ship the
 * numbers), and the UI, which lays out only the boxes that will have data.
 */

export type DashboardRole = 'owner' | 'manager' | 'supervisor' | 'cashier' | 'staff';

export type DashboardPeriod = 'today' | 'week' | 'month' | 'custom';

/** One entry per dashboard box that §11A rules on. */
export type DashboardElement =
  | 'sales' // Total Sales, Bills Raised, Avg Bill Value (+ YoY)
  | 'profit' // Gross Profit & Margin (+ YoY), cost coverage
  | 'basket' // UPT, Avg Item Value
  | 'returns'
  | 'customers'
  | 'discount'
  | 'paymentSplit'
  | 'recentTransactions'
  | 'staff'
  | 'alerts'
  | 'insight'
  | 'inventorySold'
  | 'eod'
  | 'actionable'
  | 'weeklyInventory';

/**
 * - `full`: everything, every period.
 * - `today`: only on the Today tab.
 * - `own`: only the viewer's own bills (or own returns, own sales line).
 * - `ownShift`: only the viewer's own shift.
 * - `operational`: alerts that are about running the floor today (held bills,
 *   a dead peak hour, a SKU that keeps coming back), not about people or
 *   marketing.
 * - `hidden`: not at all.
 */
export type AccessLevel = 'full' | 'today' | 'own' | 'ownShift' | 'operational' | 'hidden';

const SENIOR: Record<DashboardElement, AccessLevel> = {
  sales: 'full',
  profit: 'full',
  basket: 'full',
  returns: 'full',
  customers: 'full',
  discount: 'full',
  paymentSplit: 'full',
  recentTransactions: 'full',
  staff: 'full',
  alerts: 'full',
  insight: 'full',
  inventorySold: 'full',
  eod: 'full',
  actionable: 'full',
  weeklyInventory: 'full',
};

const SUPERVISOR: Record<DashboardElement, AccessLevel> = {
  sales: 'today',
  profit: 'hidden',
  basket: 'full',
  returns: 'today',
  customers: 'full',
  discount: 'today',
  paymentSplit: 'full',
  recentTransactions: 'today',
  staff: 'ownShift',
  alerts: 'operational',
  insight: 'hidden',
  inventorySold: 'hidden',
  eod: 'ownShift',
  actionable: 'hidden',
  weeklyInventory: 'hidden',
};

const CASHIER: Record<DashboardElement, AccessLevel> = {
  sales: 'hidden',
  profit: 'hidden',
  basket: 'own',
  returns: 'own',
  customers: 'hidden',
  discount: 'hidden',
  paymentSplit: 'hidden',
  recentTransactions: 'own',
  staff: 'own',
  alerts: 'hidden',
  insight: 'hidden',
  inventorySold: 'hidden',
  eod: 'hidden',
  actionable: 'hidden',
  weeklyInventory: 'hidden',
};

const TABLE: Record<DashboardRole, Record<DashboardElement, AccessLevel>> = {
  owner: SENIOR,
  manager: SENIOR,
  supervisor: SUPERVISOR,
  // `staff` bills under the same restricted login as a cashier.
  cashier: CASHIER,
  staff: CASHIER,
};

export function dashboardAccess(role: string, element: DashboardElement): AccessLevel {
  return (TABLE as Record<string, Record<DashboardElement, AccessLevel>>)[role]?.[element] ?? 'hidden';
}

/** Whether `element` shows at all for `role` on the `period` tab. */
export function canSeeOnDashboard(role: string, element: DashboardElement, period: DashboardPeriod): boolean {
  const level = dashboardAccess(role, element);
  if (level === 'hidden') return false;
  if (level === 'today') return period === 'today';
  return true;
}

/** Owner and Manager: may dismiss alerts and act on the Daily Actionable widget. */
export function isDashboardSenior(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

/** Alert types a supervisor sees under `operational` access (§11A). */
export const OPERATIONAL_ALERT_TYPES = ['held_bill', 'no_sale_peak', 'repeat_return_sku'] as const;
