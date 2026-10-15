import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { dateOnly, ymdOf } from '../../utils/ist';
import { addDays, mondayOf } from './periods';
import { round2 } from './metrics';

/**
 * Dashboard spec §15.6: the Weekly Inventory Reminder, and the lists it
 * routes to. One query per question, shared by the strip and the interim
 * stock list, so they can never disagree (§15.6: "build the query once").
 *
 * Low stock: a variant below its reorder level. The level is the branch's own
 * `Inventory.minStockLevel` when set above zero, else the article's
 * `Product.reorderLevel`. Articles with neither are one-off pieces that are
 * not restocked by count, and are never "low".
 *
 * Stagnant: pieces on the shelf that have not sold for `days` or more. A piece
 * that never sold counts from when it arrived. Frozen value is at landed cost;
 * pieces with no cost recorded are counted but add nothing to the ₹ figure.
 */

export type StockView = 'low' | 'stagnant';

export interface StockRow {
  variantId: number;
  productId: number;
  name: string;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  reorderLevel: number | null;
  unitCost: number | null;
  costValue: number | null;
  lastSoldOn: string | null;
  /** Days without a sale: since the last sale, or since it arrived if it never sold. */
  daysIdle: number | null;
}

export interface StockTotals {
  skus: number;
  pieces: number;
  /** At landed cost; pieces with no cost add nothing. */
  value: number;
}

const lowStockWhere = (branchId: number) => Prisma.sql`
  i."branchId" = ${branchId} AND v."isActive" = true AND p."isActive" = true
  AND COALESCE(NULLIF(i."minStockLevel", 0), p."reorderLevel") IS NOT NULL
  AND i.quantity < COALESCE(NULLIF(i."minStockLevel", 0), p."reorderLevel")`;

/** The landed-cost order the P&L and checkout use (`pos/pricing.ts` landedUnitCost). */
const unitCostSql = Prisma.sql`NULLIF(COALESCE(v."landingOverride", p."landingPrice", v."costOverride", p."costPrice"), 0)`;

function stagnantCte(branchId: number, asOf: Date, days: number) {
  return Prisma.sql`
    WITH last_sale AS (
      SELECT si."variantId", MAX(s."businessDate") AS d
      FROM sale_items si JOIN sales s ON s.id = si."saleId"
      WHERE s."branchId" = ${branchId} AND s.status <> 'void' AND s."businessDate" <= ${asOf}
      GROUP BY si."variantId"
    ),
    arrived AS (
      SELECT m."variantId", MIN(m."createdAt") AS d
      FROM inventory_movements m
      WHERE m."branchId" = ${branchId} AND m.type = 'purchase'
      GROUP BY m."variantId"
    ),
    shelf AS (
      SELECT i."variantId", i.quantity, v.sku, v.size, v.color, p.id AS product_id, p.name,
             ${unitCostSql} AS unit_cost,
             ls.d AS last_sold,
             COALESCE(ls.d, (arrived.d AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, v."createdAt"::date) AS since
      FROM inventory i
      JOIN product_variants v ON v.id = i."variantId"
      JOIN products p ON p.id = v."productId"
      LEFT JOIN last_sale ls ON ls."variantId" = i."variantId"
      LEFT JOIN arrived ON arrived."variantId" = i."variantId"
      WHERE i."branchId" = ${branchId} AND i.quantity > 0 AND v."isActive" = true
    )
    SELECT * FROM shelf WHERE since <= ${new Date(asOf.getTime() - days * 86400_000)}`;
}

/** Totals over the WHOLE list (the page shows at most 1,000 rows). */
export async function stockTotals(branchId: number, view: StockView, asOfDay: string, days = 60): Promise<StockTotals> {
  const [row] =
    view === 'low'
      ? await prisma.$queryRaw<any[]>`
          SELECT COUNT(*) AS skus, COALESCE(SUM(i.quantity), 0) AS pieces,
                 COALESCE(SUM(i.quantity * ${unitCostSql}), 0) AS value
          FROM inventory i
          JOIN product_variants v ON v.id = i."variantId" JOIN products p ON p.id = v."productId"
          WHERE ${lowStockWhere(branchId)}`
      : await prisma.$queryRaw<any[]>`
          SELECT COUNT(*) AS skus, COALESCE(SUM(quantity), 0) AS pieces, COALESCE(SUM(quantity * unit_cost), 0) AS value
          FROM (${stagnantCte(branchId, dateOnly(asOfDay), days)}) x`;
  return { skus: Number(row.skus), pieces: Number(row.pieces), value: round2(Number(row.value)) };
}

export async function reminderCounts(branchId: number, asOfDay: string, stagnantDays = 60) {
  const asOf = dateOnly(asOfDay);
  const [[low], [stag]] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT COUNT(*) AS n FROM inventory i
      JOIN product_variants v ON v.id = i."variantId" JOIN products p ON p.id = v."productId"
      WHERE ${lowStockWhere(branchId)}`,
    prisma.$queryRaw<any[]>`
      SELECT COUNT(*) AS n, COALESCE(SUM(quantity * unit_cost), 0) AS frozen
      FROM (${stagnantCte(branchId, asOf, stagnantDays)}) x`,
  ]);
  return { lowStock: Number(low.n), stagnant: Number(stag.n), frozenValue: round2(Number(stag.frozen)) };
}

/** The interim list behind "View report →" until the Reports module ships. */
export async function stockList(branchId: number, view: StockView, asOfDay: string, days = 60): Promise<StockRow[]> {
  const asOf = dateOnly(asOfDay);
  const rows =
    view === 'low'
      ? await prisma.$queryRaw<any[]>`
          SELECT i."variantId", i.quantity, v.sku, v.size, v.color, p.id AS product_id, p.name,
                 COALESCE(NULLIF(i."minStockLevel", 0), p."reorderLevel") AS reorder_level,
                 ${unitCostSql} AS unit_cost,
                 (SELECT MAX(s."businessDate") FROM sale_items si JOIN sales s ON s.id = si."saleId"
                   WHERE si."variantId" = i."variantId" AND s."branchId" = ${branchId} AND s.status <> 'void') AS last_sold
          FROM inventory i
          JOIN product_variants v ON v.id = i."variantId" JOIN products p ON p.id = v."productId"
          WHERE ${lowStockWhere(branchId)}
          ORDER BY (COALESCE(NULLIF(i."minStockLevel", 0), p."reorderLevel") - i.quantity) DESC, p.name
          LIMIT 1000`
      : await prisma.$queryRaw<any[]>`
          SELECT x.*, NULL AS reorder_level FROM (${stagnantCte(branchId, asOf, days)}) x
          ORDER BY x.quantity * COALESCE(x.unit_cost, 0) DESC, x.since ASC
          LIMIT 1000`;

  return rows.map((r) => {
    const unitCost = r.unit_cost != null ? Number(r.unit_cost) : null;
    const lastSold = r.last_sold ? ymdOf(new Date(r.last_sold)) : null;
    const idleFrom = r.since ? ymdOf(new Date(r.since)) : lastSold;
    return {
      variantId: Number(r.variantId),
      productId: Number(r.product_id),
      name: r.name,
      sku: r.sku,
      size: r.size,
      color: r.color,
      quantity: Number(r.quantity),
      reorderLevel: r.reorder_level != null ? Number(r.reorder_level) : null,
      unitCost,
      costValue: unitCost != null ? round2(unitCost * Number(r.quantity)) : null,
      lastSoldOn: lastSold,
      daysIdle: idleFrom ? Math.round((asOf.getTime() - dateOnly(idleFrom).getTime()) / 86400_000) : null,
    };
  });
}

export interface WeeklyReminder {
  weekStart: string;
  lowStock: number;
  /** Change against last week's snapshot; null on the first week. */
  lowStockDelta: number | null;
  stagnant: number;
  frozenValue: number;
  stagnantDays: number;
  computedAt: string;
  dismissKey: string;
}

/**
 * This week's numbers, computed once on the first look of the week and then
 * served from the snapshot (§15.6 cadence). Earlier weeks are never recomputed:
 * last week's figure is what last week said.
 */
export async function weeklyReminder(branchId: number, businessDate: string): Promise<WeeklyReminder> {
  const weekStart = mondayOf(businessDate);
  const lastWeek = addDays(weekStart, -7);
  let row = await prisma.inventoryWeeklySnapshot.findUnique({
    where: { branchId_weekStart: { branchId, weekStart: dateOnly(weekStart) } },
  });
  if (!row) {
    const c = await reminderCounts(branchId, businessDate);
    row = await prisma.inventoryWeeklySnapshot.upsert({
      where: { branchId_weekStart: { branchId, weekStart: dateOnly(weekStart) } },
      create: { branchId, weekStart: dateOnly(weekStart), lowStockCount: c.lowStock, stagnantCount: c.stagnant, frozenValue: c.frozenValue },
      update: {},
    });
  }
  const prev = await prisma.inventoryWeeklySnapshot.findUnique({
    where: { branchId_weekStart: { branchId, weekStart: dateOnly(lastWeek) } },
    select: { lowStockCount: true },
  });
  return {
    weekStart,
    lowStock: row.lowStockCount,
    lowStockDelta: prev ? row.lowStockCount - prev.lowStockCount : null,
    stagnant: row.stagnantCount,
    frozenValue: Number(row.frozenValue),
    stagnantDays: 60,
    computedAt: row.computedAt.toISOString(),
    dismissKey: `weekly:${weekStart}`,
  };
}
