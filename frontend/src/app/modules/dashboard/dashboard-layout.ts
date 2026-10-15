import type { DashboardElement } from '@clothing-erp/shared';

/**
 * Dashboard spec §1.3 / §1.3b: the boxes, their default arrangement (zones B
 * to K, top to bottom), and the rules for moving and resizing them.
 *
 * The desktop grid is 12 columns wide; heights are whole row units. Every box
 * has a minimum size so its content never clips. A saved layout is merged
 * with this list on load, so a box added in a later release appears in its
 * default place, and a box that no longer exists simply drops out.
 *
 * The top bar (zone A) is not a box: it carries the period tabs and the live
 * indicator, and a header you can drag into the middle of the page would make
 * the page harder to read, not easier.
 */

export const GRID_COLUMNS = 12;
export const LAYOUT_VERSION = 1;

export type BoxId =
  | 'total-sales'
  | 'bills'
  | 'avg-bill'
  | 'profit'
  | 'basket'
  | 'returns'
  | 'customers'
  | 'discount'
  | 'payment-split'
  | 'recent'
  | 'staff'
  | 'alerts'
  | 'inventory-sold'
  | 'insight'
  | 'eod'
  | 'actionable'
  | 'weekly-inventory';

export interface BoxDef {
  id: BoxId;
  /** The §11A element that decides whether the viewer gets this box. */
  element: DashboardElement;
  title: string;
  zone: string;
  w: number;
  h: number;
  minW: number;
  minH: number;
  /**
   * Shown only when there is something to show (Cash in Drawer before the
   * shift closes). It keeps its slot in the saved order while hidden.
   */
  conditional?: boolean;
}

export const BOXES: readonly BoxDef[] = [
  { id: 'total-sales', element: 'sales', title: 'Total Sales', zone: 'B', w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'bills', element: 'sales', title: 'Bills Raised', zone: 'B', w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'avg-bill', element: 'sales', title: 'Avg Bill Value', zone: 'B', w: 3, h: 2, minW: 2, minH: 2 },
  { id: 'profit', element: 'profit', title: 'Gross Profit & Margin', zone: 'B', w: 3, h: 2, minW: 3, minH: 2 },
  { id: 'basket', element: 'basket', title: 'Basket', zone: 'C', w: 12, h: 1, minW: 6, minH: 1 },
  { id: 'returns', element: 'returns', title: 'Returns', zone: 'D', w: 4, h: 2, minW: 3, minH: 2 },
  { id: 'customers', element: 'customers', title: 'Customers Served', zone: 'D', w: 4, h: 2, minW: 3, minH: 2 },
  { id: 'discount', element: 'discount', title: 'Discount', zone: 'D', w: 4, h: 2, minW: 3, minH: 2 },
  { id: 'payment-split', element: 'paymentSplit', title: 'Payment Mode Split', zone: 'E', w: 12, h: 2, minW: 4, minH: 2 },
  { id: 'recent', element: 'recentTransactions', title: 'Recent Transactions', zone: 'F', w: 5, h: 7, minW: 4, minH: 4 },
  { id: 'staff', element: 'staff', title: 'Staff Performance', zone: 'F', w: 3, h: 7, minW: 3, minH: 3 },
  { id: 'alerts', element: 'alerts', title: 'Active Alerts', zone: 'F', w: 4, h: 7, minW: 3, minH: 3 },
  { id: 'inventory-sold', element: 'inventorySold', title: 'Inventory Value Sold', zone: 'G', w: 12, h: 1, minW: 4, minH: 1 },
  { id: 'insight', element: 'insight', title: 'Insight', zone: 'H', w: 12, h: 1, minW: 6, minH: 1 },
  { id: 'eod', element: 'eod', title: 'Cash in Drawer', zone: 'I', w: 12, h: 1, minW: 6, minH: 1, conditional: true },
  { id: 'actionable', element: 'actionable', title: 'Daily Actionable', zone: 'J', w: 12, h: 2, minW: 6, minH: 2 },
  { id: 'weekly-inventory', element: 'weeklyInventory', title: 'Weekly Inventory Reminder', zone: 'K', w: 12, h: 1, minW: 6, minH: 1 },
];

export const BOX_BY_ID = new Map<BoxId, BoxDef>(BOXES.map((b) => [b.id, b]));

export interface LayoutBox {
  id: BoxId;
  w: number;
  h: number;
}

export interface SavedLayout {
  version: number;
  boxes: LayoutBox[];
}

export function defaultLayout(): LayoutBox[] {
  return BOXES.map(({ id, w, h }) => ({ id, w, h }));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Keep a box inside the grid and at least its minimum size. */
export function clampBox(box: LayoutBox): LayoutBox {
  const def = BOX_BY_ID.get(box.id)!;
  return { id: box.id, w: clamp(box.w, def.minW, GRID_COLUMNS), h: clamp(box.h, def.minH, 20) };
}

/**
 * A saved layout made current: unknown ids dropped, sizes clamped, and any
 * box the saved copy has never seen slotted in after its default neighbour.
 */
export function mergeLayout(saved: SavedLayout | null | undefined): LayoutBox[] {
  if (!saved || !Array.isArray(saved.boxes) || saved.version !== LAYOUT_VERSION) return defaultLayout();
  const seen = new Set<BoxId>();
  const out: LayoutBox[] = [];
  for (const b of saved.boxes) {
    if (!BOX_BY_ID.has(b.id) || seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(clampBox(b));
  }
  BOXES.forEach((def, i) => {
    if (seen.has(def.id)) return;
    const before = BOXES.slice(0, i).reverse().find((d) => seen.has(d.id));
    const at = before ? out.findIndex((b) => b.id === before.id) + 1 : 0;
    out.splice(at, 0, { id: def.id, w: def.w, h: def.h });
    seen.add(def.id);
  });
  return out;
}

/** Move `id` to sit just before (or after) `targetId`. */
export function moveBox(layout: LayoutBox[], id: BoxId, targetId: BoxId, after: boolean): LayoutBox[] {
  if (id === targetId) return layout;
  const moving = layout.find((b) => b.id === id);
  if (!moving) return layout;
  const rest = layout.filter((b) => b.id !== id);
  const t = rest.findIndex((b) => b.id === targetId);
  if (t < 0) return layout;
  rest.splice(after ? t + 1 : t, 0, moving);
  return rest;
}

export function resizeBox(layout: LayoutBox[], id: BoxId, w: number, h: number): LayoutBox[] {
  return layout.map((b) => (b.id === id ? clampBox({ id, w, h }) : b));
}

export function sameLayout(a: LayoutBox[], b: LayoutBox[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.w === b[i].w && x.h === b[i].h);
}
