import type { AccessLevel, Comparison, DashboardElement, DashboardPeriod } from '@clothing-erp/shared';

/** Mirrors `GET /api/v1/dashboard` (backend/src/modules/dashboard/service.ts). */

export interface Compared {
  prev: Comparison;
  yoy?: Comparison;
}

export interface DayRange {
  from: string;
  to: string;
}

export interface DashboardMeta {
  storeName: string;
  branchId: number;
  businessDate: string;
  period: DashboardPeriod;
  range: DayRange;
  previousRange: DayRange;
  lastYearRange: DayRange | null;
  hasLastYear: boolean;
  generatedAt: string;
  role: string;
}

export interface SalesBlock {
  totalSales: number;
  bills: number;
  avgBill: number;
  compare: { totalSales: Compared; bills: Compared; avgBill: Compared };
}

export interface ProfitBlock {
  grossProfit: number;
  marginPct: number | null;
  costedSales: number;
  totalSales: number;
  coveragePct: number | null;
  coverageLevel: 'ok' | 'amber' | 'red';
  uncostedLines: number;
  compare: { grossProfit: Compared; marginPct: Compared };
}

export interface BasketBlock {
  upt: number | null;
  avgItemValue: number | null;
  items: number;
  uptBaseline8w: number | null;
  compare: { upt: Compared; uptVsBaseline: Comparison | null; avgItemValue: { prev: Comparison } };
  ownOnly: boolean;
}

export interface ReasonCount {
  code: string;
  label: string | null;
  count: number;
}

export interface ReturnsBlock {
  count: number;
  value: number;
  exchanges: number;
  topReasons: ReasonCount[];
  reasons: ReasonCount[];
  compare: { count: { prev: Comparison }; value: { prev: Comparison } };
  ownOnly: boolean;
}

export interface CustomersBlock {
  identified: number;
  returning: number;
  returningPct: number | null;
  walkIns: number;
  compare: { identified: { prev: Comparison }; walkIns: { prev: Comparison }; returningPct: Compared };
}

export interface DiscountBlock {
  value: number;
  pctOfGross: number | null;
  compare: { value: { prev: Comparison }; pct: { prev: Comparison } };
}

export interface PaymentShare {
  mode: string;
  value: number;
  pct: number;
}

export interface InventorySoldBlock {
  valueAtCost: number;
  uncostedLines: number;
  compare: { prev: Comparison };
}

export type TransactionBadge = 'paid' | 'exchange' | 'return' | 'hold' | 'high_discount';

export interface RecentTransaction {
  kind: 'sale' | 'return' | 'hold';
  id: number;
  number: string | null;
  name: string;
  customerId: number | null;
  at: string;
  mode: string | null;
  amount: number;
  reason: string | null;
  badge: TransactionBadge;
  discountPct: number | null;
}

export interface StaffLine {
  userId: number;
  name: string;
  value: number;
  bills: number;
  items: number;
  upt: number | null;
  returnRate: number | null;
  top: boolean;
}

export type AlertSeverity = 'red' | 'amber' | 'blue' | 'purple';

export interface DashboardAlert {
  key: string;
  type: 'return_rate' | 'held_bill' | 'loyalty_expiring' | 'no_sale_peak' | 'repeat_return_sku';
  severity: AlertSeverity;
  title: string;
  detail: string;
  subject: { kind: 'held' | 'product' | 'user' | 'loyalty' | 'hour'; id: number } | null;
}

export interface Insight {
  key: string;
  type: string;
  text: string;
}

export type Tier = 'good' | 'attention' | 'critical';

export interface EodSummary {
  businessDate: string;
  sessions: number;
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  expected: number;
  counted: number;
  variance: number;
  status: 'balanced' | 'short' | 'over';
  tier: Tier;
  closedAt: string;
}

export interface ActionableItem {
  key: 'attendance' | 'expenses' | 'salary' | 'pending_sales' | 'upi';
  state: 'done' | 'pending' | 'hidden';
  tier: Tier;
  label: string;
  detail: string | null;
  month?: string;
}

export interface WeeklyReminder {
  weekStart: string;
  lowStock: number;
  lowStockDelta: number | null;
  stagnant: number;
  frozenValue: number;
  stagnantDays: number;
  computedAt: string;
  dismissKey: string;
}

export interface DashboardData {
  meta: DashboardMeta;
  sales?: SalesBlock;
  profit?: ProfitBlock;
  basket?: BasketBlock;
  returns?: ReturnsBlock;
  customers?: CustomersBlock;
  discount?: DiscountBlock;
  paymentSplit?: PaymentShare[];
  inventorySold?: InventorySoldBlock;
  recentTransactions?: RecentTransaction[];
  staff?: { lines: StaffLine[]; ownOnly: boolean };
  alerts?: DashboardAlert[];
  insight?: Insight | null;
  eod?: EodSummary | null;
  actionable?: { items: ActionableItem[] };
  weeklyInventory?: WeeklyReminder | null;
  access: Record<DashboardElement, AccessLevel>;
}

export interface PeriodSelection {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}
