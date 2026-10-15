/**
 * DEV ONLY: fills a local database with ~14 months of believable trading so the
 * business dashboard can be built and checked against real-looking numbers
 * (YoY needs a year of history, the UPT and peak-hour baselines need 8 weeks).
 *
 *   cd backend && npx ts-node scripts/dev-dashboard-data.ts
 *
 * Refuses to run unless DATABASE_URL points at localhost. It writes rows in the
 * shapes checkout and returns produce (cost snapshot, reason codes, trading
 * days), but straight through Prisma, because checkout will not bill into a
 * shift dated in the past, which is exactly what history is.
 *
 * Deterministic: a fixed seed gives the same store every run. Re-running wipes
 * the generated rows first (everything tagged DEV-), not the seed data.
 */
import { PrismaClient, PaymentMethod, ReturnReason } from '@prisma/client';
import { dateOnly, toIstYmd } from '../src/utils/ist';

const url = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('Refusing to run: DATABASE_URL is not a localhost database.');
  process.exit(1);
}

const prisma = new PrismaClient();
const BRANCH_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_MS = 5.5 * 60 * 60 * 1000;
const HISTORY_DAYS = 430;

// ─── Deterministic randomness ───────────────────────────────────────────────
let seed = 20261015;
function rnd(): number {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
function weighted<T>(pairs: readonly [T, number][]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** An instant at `hour:minute` IST on the trading day `day` (UTC midnight). */
const istInstant = (day: Date, hour: number, minute: number) =>
  new Date(day.getTime() + (hour * 60 + minute) * 60 * 1000 - IST_MS);

// ─── Catalogue ──────────────────────────────────────────────────────────────
const CATEGORIES: { name: string; price: [number, number]; weight: number; words: string[] }[] = [
  { name: 'Kurtis', price: [449, 1199], weight: 30, words: ['Chikankari', 'Anarkali', 'A-line', 'Straight', 'Printed', 'Rayon'] },
  { name: 'Cordsets', price: [799, 1799], weight: 22, words: ['Cotton', 'Linen', 'Muslin', 'Embroidered', 'Block print'] },
  { name: 'Suits', price: [1199, 2999], weight: 16, words: ['Sharara', 'Palazzo', 'Patiala', 'Pakistani', 'Georgette'] },
  { name: 'Sarees', price: [999, 3999], weight: 8, words: ['Banarasi', 'Chiffon', 'Organza', 'Kanjivaram', 'Linen'] },
  { name: 'Dupattas', price: [249, 699], weight: 12, words: ['Phulkari', 'Bandhani', 'Chanderi', 'Net'] },
  { name: 'Kids Wear', price: [399, 1199], weight: 12, words: ['Frock', 'Lehenga', 'Gharara', 'Kurta set'] },
];
const COLOURS = ['Peach', 'Mint', 'Maroon', 'Mustard', 'Navy', 'Ivory', 'Rani pink', 'Bottle green', 'Lilac', 'Black'];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'Free'];
const FIRST = ['Ayesha', 'Priya', 'Farah', 'Neha', 'Sana', 'Zoya', 'Meera', 'Huma', 'Kavya', 'Rukhsana', 'Iqra', 'Pooja', 'Aliya', 'Divya', 'Nida', 'Shreya', 'Mehreen', 'Tanya', 'Rabia', 'Anjali'];
const LAST = ['Khan', 'Sharma', 'Shaikh', 'Patel', 'Ansari', 'Iyer', 'Qureshi', 'Mehta', 'Siddiqui', 'Rao', 'Sayyed', 'Joshi'];

const REASONS: [ReturnReason, number][] = [
  ['size_issue', 46],
  ['colour_mismatch', 16],
  ['defect_damage', 12],
  ['changed_mind', 14],
  ['wrong_item', 4],
  ['not_as_expected', 8],
];

// Share of a day's bills that fall in each IST hour (shop 10:30 to 21:30).
const HOURS: [number, number][] = [
  [10, 2], [11, 5], [12, 7], [13, 7], [14, 6], [15, 7], [16, 9], [17, 12], [18, 15], [19, 15], [20, 11], [21, 4],
];

/** Season and festival multipliers on the base bill count. */
function seasonFactor(day: Date): number {
  const m = day.getUTCMonth(); // 0 = Jan
  const base = [0.85, 0.8, 0.95, 1.0, 0.9, 0.8, 0.75, 0.85, 0.95, 1.25, 1.35, 1.05][m];
  const d = day.getUTCDate();
  // Diwali / Eid style spikes in the second half of October and early November.
  const festival = (m === 9 && d >= 15) || (m === 10 && d <= 10) ? 1.35 : 1;
  return base * festival;
}
const WEEKDAY = [1.25, 0.8, 0.85, 0.9, 0.95, 1.1, 1.45]; // Sun..Sat

async function wipe() {
  // Generated rows only: every one is reachable from a DEV- tagged sale, user,
  // product or customer. Order follows the foreign keys.
  await prisma.$transaction([
    prisma.returnItem.deleteMany({ where: { returnRecord: { returnNumber: { startsWith: 'DEV-' } } } }),
    prisma.return.deleteMany({ where: { returnNumber: { startsWith: 'DEV-' } } }),
    prisma.loyaltyTransaction.deleteMany({ where: { sale: { saleNumber: { startsWith: 'DEV-' } } } }),
    prisma.payment.deleteMany({ where: { sale: { saleNumber: { startsWith: 'DEV-' } } } }),
    prisma.saleItem.deleteMany({ where: { sale: { saleNumber: { startsWith: 'DEV-' } } } }),
    prisma.sale.deleteMany({ where: { saleNumber: { startsWith: 'DEV-' } } }),
    prisma.varianceLog.deleteMany({ where: { session: { notes: 'DEV' } } }),
    prisma.posSession.deleteMany({ where: { notes: 'DEV' } }),
    prisma.heldTransaction.deleteMany({ where: { notes: 'DEV' } }),
    prisma.payablePayment.deleteMany({ where: { payable: { dedupeKey: { startsWith: 'DEV-' } } } }),
    prisma.payable.deleteMany({ where: { dedupeKey: { startsWith: 'DEV-' } } }),
    prisma.expenseDayMark.deleteMany({}),
    prisma.dashboardDismissal.deleteMany({}),
    prisma.attendance.deleteMany({ where: { user: { email: { startsWith: 'dev.' } } } }),
    prisma.inventoryMovement.deleteMany({ where: { variant: { sku: { startsWith: 'DEV-' } } } }),
    prisma.inventory.deleteMany({ where: { variant: { sku: { startsWith: 'DEV-' } } } }),
    prisma.productVariant.deleteMany({ where: { sku: { startsWith: 'DEV-' } } }),
    prisma.product.deleteMany({ where: { slug: { startsWith: 'dev-' } } }),
    prisma.customer.deleteMany({ where: { email: { endsWith: '@dev.local' } } }),
    prisma.userPreference.deleteMany({}),
  ]);
  // Users last: other branches' rows may still reference them otherwise.
  await prisma.user.deleteMany({ where: { email: { startsWith: 'dev.' } } });
}

async function main() {
  console.log('Wiping previous generated data…');
  await wipe();

  const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@clothingerp.com' } });
  const brand = await prisma.brand.upsert({
    where: { slug: 'sabihas' },
    update: {},
    create: { name: "Sabiha's", slug: 'sabihas' },
  });

  // ─── Staff: one login per role, all with the admin password (admin123) ───
  const mk = (first: string, last: string, role: 'manager' | 'supervisor' | 'cashier' | 'staff', email: string) =>
    prisma.user.create({
      data: {
        branchId: BRANCH_ID,
        email,
        passwordHash: admin.passwordHash,
        firstName: first,
        lastName: last,
        role,
        salaryType: 'fixed_monthly',
        monthlySalary: role === 'manager' ? 32000 : role === 'supervisor' ? 22000 : 16000,
        perDayRate: role === 'manager' ? 1070 : role === 'supervisor' ? 730 : 530,
        weeklyOffDay: 2,
        commissionRate: role === 'staff' ? 1.5 : 0,
        joiningDate: dateOnly('2024-06-01'),
      },
    });
  const manager = await mk('Farhan', 'Qureshi', 'manager', 'dev.manager@clothingerp.com');
  const supervisor = await mk('Rukhsar', 'Ansari', 'supervisor', 'dev.supervisor@clothingerp.com');
  const cashier = await mk('Asma', 'Shaikh', 'cashier', 'dev.cashier@clothingerp.com');
  const salespeople = [
    await mk('Nazia', 'Khan', 'staff', 'dev.nazia@clothingerp.com'),
    await mk('Shabana', 'Patel', 'staff', 'dev.shabana@clothingerp.com'),
    await mk('Rehan', 'Sayyed', 'staff', 'dev.rehan@clothingerp.com'),
  ];
  const staffList = [manager, supervisor, cashier, ...salespeople];

  // ─── Catalogue: mostly one piece per article (single-size inventory) ───
  console.log('Creating catalogue…');
  const categoryIds = new Map<string, number>();
  for (const c of CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { slug: `dev-${c.name.toLowerCase().replace(/\s+/g, '-')}` },
      update: {},
      create: { name: c.name, slug: `dev-${c.name.toLowerCase().replace(/\s+/g, '-')}` },
    });
    categoryIds.set(c.name, cat.id);
  }

  const today = dateOnly(toIstYmd(new Date()));
  const firstDay = new Date(today.getTime() - HISTORY_DAYS * DAY_MS);

  interface V {
    id: number;
    price: number;
    mrp: number;
    cost: number | null;
    category: string;
    stockIn: Date;
    onHand: number;
  }
  const variants: V[] = [];
  /** Pieces on the shelf right now; sold-out variants are swapped out. */
  const pool: V[] = [];
  let skuSeq = 0;
  let productSeq = 0;

  /**
   * A delivery: `nProducts` new articles arrive on `day`. Mostly one piece of
   * one size (single-size inventory), sometimes two or three sizes.
   */
  async function receiveStock(day: Date, nProducts: number) {
    const specs = Array.from({ length: nProducts }, () => {
      const c = weighted(CATEGORIES.map((x) => [x, x.weight] as [typeof x, number]));
      const price = roundTo(c.price[0] + rnd() * (c.price[1] - c.price[0]), 50) - 1;
      const mrp = roundTo(price * (1.12 + rnd() * 0.15), 50) - 1;
      // About 1 in 16 articles came in with no cost recorded.
      const cost = rnd() < 0.06 ? null : round2(price * (0.42 + rnd() * 0.18));
      const landing = cost != null && rnd() < 0.5 ? round2(cost * 1.06) : null;
      const name = `${pick(c.words)} ${c.name === 'Kids Wear' ? 'kids ' : ''}${pick(COLOURS)} ${c.name.replace(/s$/, '')}`;
      productSeq++;
      return { c, price, mrp, cost, landing, name, seq: productSeq };
    });
    const products = await prisma.product.createManyAndReturn({
      data: specs.map((x) => ({
        brandId: brand.id,
        categoryId: categoryIds.get(x.c.name)!,
        name: x.name,
        slug: `dev-${x.seq}-${x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        mrp: x.mrp,
        basePrice: x.price,
        costPrice: x.cost ?? 0,
        landingPrice: x.landing,
        createdAt: day,
      })),
      select: { id: true, slug: true },
    });
    const bySlug = new Map(products.map((p) => [p.slug, p.id]));
    const variantRows: any[] = [];
    const meta: Omit<V, 'id'>[] = [];
    for (const x of specs) {
      const productId = bySlug.get(`dev-${x.seq}-${x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)!;
      const n = rnd() < 0.7 ? 1 : rnd() < 0.7 ? 2 : 3;
      const sizes = [...SIZES].sort(() => rnd() - 0.5).slice(0, n);
      for (const size of sizes) {
        skuSeq++;
        variantRows.push({
          productId,
          sku: `DEV-${String(skuSeq).padStart(6, '0')}`,
          barcode: `89${String(1000000 + skuSeq)}`,
          size,
          color: pick(COLOURS),
          mrpOverride: x.mrp,
          priceOverride: x.price,
          costOverride: x.cost,
          landingOverride: x.landing,
          createdAt: day,
        });
        meta.push({
          price: x.price,
          mrp: x.mrp,
          cost: x.landing ?? x.cost,
          category: x.c.name,
          stockIn: day,
          onHand: rnd() < 0.8 ? 1 : rnd() < 0.7 ? 2 : 3,
        });
      }
    }
    const created = await prisma.productVariant.createManyAndReturn({ data: variantRows, select: { id: true } });
    created.forEach((row, i) => {
      const v: V = { id: row.id, ...meta[i] };
      variants.push(v);
      pool.push(v);
    });
  }

  /** Take one random piece off the shelf (or null when the shelf is bare). */
  function takePiece(exclude: V[]): V | null {
    for (let tries = 0; tries < 6 && pool.length > 0; tries++) {
      const i = Math.floor(rnd() * pool.length);
      const v = pool[i];
      if (exclude.includes(v)) continue;
      v.onHand -= 1;
      if (v.onHand <= 0) {
        pool[i] = pool[pool.length - 1];
        pool.pop();
      }
      return v;
    }
    return null;
  }

  /** A returned piece goes back on the shelf. */
  function restock(v: V) {
    if (v.onHand <= 0) pool.push(v);
    v.onHand += 1;
  }

  // Opening stock, a year and a bit ago.
  await receiveStock(firstDay, 1400);

  // ─── Customers ───
  console.log('Creating customers…');
  const created = await prisma.customer.createManyAndReturn({
    data: Array.from({ length: 9000 }, (_, i) => ({
      firstName: pick(FIRST),
      lastName: pick(LAST),
      phone: `9${String(100000000 + i * 97).padStart(9, '0').slice(0, 9)}`,
      email: `cust${i}@dev.local`,
      createdAt: firstDay,
    })),
    select: { id: true },
  });
  const customers = created.map((c) => c.id);
  const unseen = [...customers];
  const seen: number[] = [];

  // ─── Trading history ───
  console.log('Generating sales…');
  let billSeq = 0;
  let returnSeq = 0;
  const soldLines: { saleItemId: number; saleId: number; variantId: number; total: number; qty: number; day: Date; sale: any }[] = [];
  const pendingReturns: { onDay: number; line: (typeof soldLines)[number]; exchange: boolean }[] = [];
  const nowIst = new Date(Date.now() + IST_MS);
  const nowHour = nowIst.getUTCHours();

  for (let dayIdx = 0; dayIdx <= HISTORY_DAYS; dayIdx++) {
    const day = new Date(firstDay.getTime() + dayIdx * DAY_MS);
    const isToday = day.getTime() === today.getTime();
    // This year trades ~16% above last year: the growth YoY should show.
    const growth = 1 + 0.16 * (dayIdx / HISTORY_DAYS);
    const expected = 26 * WEEKDAY[day.getUTCDay()] * seasonFactor(day) * growth;
    let nBills = Math.max(4, Math.round(expected * (0.8 + rnd() * 0.4)));

    // A delivery every day, sized to roughly what sells, so the shelf
    // neither empties nor bloats; what does not sell becomes stagnant stock.
    if (dayIdx > 0) {
      await receiveStock(day, Math.round(expected * 1.55));
    }

    const openedAt = istInstant(day, 10, 20 + Math.floor(rnd() * 15));
    const session = await prisma.posSession.create({
      data: {
        branchId: BRANCH_ID,
        userId: cashier.id,
        openingAmount: 2000,
        businessDate: day,
        openedAt,
        status: 'open',
        notes: 'DEV',
      },
    });

    let cashTaken = 0;
    let cashRefunded = 0;
    let upiTaken = 0;
    let cardTaken = 0;

    for (let b = 0; b < nBills; b++) {
      const hour = weighted(HOURS);
      if (isToday && hour >= nowHour) continue; // today's bills stop at "now"
      const minute = Math.floor(rnd() * 60);
      const at = istInstant(day, hour, minute);
      if (at.getTime() < openedAt.getTime()) continue;

      // Basket: UPT ~1.9, better with a salesperson who cross-sells.
      const agent = weighted<(typeof salespeople)[number]>([
        [salespeople[0], 45],
        [salespeople[1], 33],
        [salespeople[2], 22],
      ]);
      const extra = agent === salespeople[0] ? 0.2 : agent === salespeople[2] ? -0.15 : 0;
      const nItems = weighted([[1, 0.42 - extra], [2, 0.33], [3, 0.17 + extra / 2], [4, 0.08 + extra / 2]] as [number, number][]);
      const chosen: V[] = [];
      for (let k = 0; k < nItems; k++) {
        const v = takePiece(chosen);
        if (v) chosen.push(v);
      }
      if (chosen.length === 0) continue;

      const identified = rnd() < 0.62;
      let customerId: number | null = null;
      if (identified) {
        // ~42% of identified bills are a returning customer once there is a pool.
        if (seen.length > 30 && rnd() < 0.42) {
          customerId = pick(seen);
        } else if (unseen.length > 0) {
          const i = Math.floor(rnd() * unseen.length);
          customerId = unseen[i];
          unseen[i] = unseen[unseen.length - 1];
          unseen.pop();
          seen.push(customerId);
        } else {
          customerId = pick(seen);
        }
      }

      const gross = chosen.reduce((s, v) => s + v.price, 0);
      const discPct = rnd() < 0.68 ? 0 : rnd() < 0.85 ? 0.03 + rnd() * 0.1 : 0.26 + rnd() * 0.1;
      const discount = roundTo(gross * discPct, 10);
      const total = gross - discount;
      const ratio = gross > 0 ? total / gross : 1;

      const method = weighted<PaymentMethod>([
        ['upi', 57],
        ['cash', 26],
        ['card', 15],
        ['voucher', 2],
      ]);
      if (method === 'cash') cashTaken += total;
      if (method === 'upi') upiTaken += total;
      if (method === 'card') cardTaken += total;

      billSeq++;
      const sale = await prisma.sale.create({
        data: {
          branchId: BRANCH_ID,
          customerId,
          userId: cashier.id,
          saleNumber: `DEV-W${String(billSeq).padStart(6, '0')}`,
          subtotal: gross,
          taxAmount: round2(total * (5 / 105)),
          discountAmount: discount,
          manualDiscountAmount: discount,
          total,
          businessDate: day,
          createdAt: at,
          items: {
            create: chosen.map((v) => ({
              variantId: v.id,
              quantity: 1,
              unitPrice: v.price,
              mrp: v.mrp,
              unitCost: v.cost,
              discount: round2(v.price * (1 - ratio)),
              taxAmount: round2(v.price * ratio * (5 / 105)),
              total: round2(v.price * ratio),
              agentId: agent.id,
            })),
          },
          payments: { create: [{ method, amount: total, createdAt: at }] },
        },
        include: { items: true },
      });

      for (const it of sale.items) {
        const line = { saleItemId: it.id, saleId: sale.id, variantId: it.variantId, total: Number(it.total), qty: 1, day, sale };
        soldLines.push(line);
        // ~4.5% of pieces come back: refunds a little more often than swaps.
        if (rnd() < 0.045) {
          pendingReturns.push({ onDay: dayIdx + 1 + Math.floor(rnd() * 8), line, exchange: rnd() < 0.4 });
        }
      }
    }

    // Returns falling due today.
    for (const pr of pendingReturns.filter((p) => p.onDay === dayIdx)) {
      if (isToday && nowHour < 12) continue;
      returnSeq++;
      const hour = 11 + Math.floor(rnd() * (isToday ? Math.max(1, nowHour - 11) : 9));
      const at = istInstant(day, hour, Math.floor(rnd() * 60));
      const reasonCode = weighted(REASONS);
      const refund = pr.line.total;
      if (!pr.exchange) cashRefunded += refund;
      await prisma.return.create({
        data: {
          originalSaleId: pr.line.saleId,
          branchId: BRANCH_ID,
          userId: cashier.id,
          returnNumber: `DEV-RT${String(returnSeq).padStart(6, '0')}`,
          type: pr.exchange ? 'exchange' : 'return',
          reasonCode,
          reason: reasonCode.replace(/_/g, ' '),
          businessDate: day,
          subtotal: refund,
          taxAmount: round2(refund * (5 / 105)),
          total: refund,
          status: 'completed',
          refundMode: 'cash',
          refundBreakup: pr.exchange ? [] : [{ method: 'cash', amount: refund }],
          createdAt: at,
          items: {
            create: [
              { saleItemId: pr.line.saleItemId, variantId: pr.line.variantId, quantity: 1, unitPrice: refund, condition: 'resellable' },
            ],
          },
        },
      });
      await prisma.saleItem.update({ where: { id: pr.line.saleItemId }, data: { returnedQuantity: 1 } });
      await prisma.sale.update({ where: { id: pr.line.saleId }, data: { status: 'partially_returned' } });
      const v = variants.find((x) => x.id === pr.line.variantId);
      if (v) restock(v);
    }

    // Shift close (not today: today is still trading).
    if (!isToday) {
      const expectedCash = round2(2000 + cashTaken - cashRefunded);
      const variance = weighted([[0, 70], [round2(20 + rnd() * 30), 15], [round2(-(20 + rnd() * 40)), 10], [round2(250 + rnd() * 400), 5]] as [number, number][]);
      const counted = round2(expectedCash - variance);
      await prisma.posSession.update({
        where: { id: session.id },
        data: {
          status: 'closed',
          closedAt: istInstant(day, 21, 35 + Math.floor(rnd() * 20)),
          expectedAmount: expectedCash,
          closingAmount: counted,
          variance,
          closingFloat: 2000,
          expectedUpi: round2(upiTaken),
          upiReceived: round2(upiTaken),
          upiVariance: 0,
          expectedCard: round2(cardTaken),
          cardReceived: round2(cardTaken),
          cardVariance: 0,
        },
      });
    }

    // Attendance: everyone marked, except the last two trading days.
    if (dayIdx < HISTORY_DAYS - 1) {
      await prisma.attendance.createMany({
        data: staffList.map((u) => ({
          userId: u.id,
          branchId: BRANCH_ID,
          date: day,
          status: day.getUTCDay() === 2 ? 'paid_weekly_off' : rnd() < 0.94 ? 'present' : rnd() < 0.5 ? 'half_day' : 'absent',
          markedBy: manager.id,
        })),
        skipDuplicates: true,
      });
    }

    // Expenses on roughly half the days; a "no expense" mark on most of the rest.
    // The last two days are left blank so the dashboard has something pending.
    if (dayIdx < HISTORY_DAYS - 1) {
      if (rnd() < 0.5) {
        const amount = roundTo(150 + rnd() * 1800, 10);
        const payable = await prisma.payable.create({
          data: {
            branchId: BRANCH_ID,
            source: 'adhoc_expense',
            categoryId: pick([2, 4, 5, 6]),
            title: pick(['Tea and snacks', 'Courier', 'Tailor alterations', 'Electrician', 'Packing bags', 'Cleaning']),
            amount,
            paidAmount: amount,
            dueDate: day,
            status: 'paid',
            dedupeKey: `DEV-${dayIdx}`,
            createdBy: manager.id,
            createdAt: istInstant(day, 13, 0),
          },
        });
        await prisma.payablePayment.create({
          data: { payableId: payable.id, amount, method: 'cash', paidAt: istInstant(day, 13, 5), createdBy: manager.id },
        });
      } else if (rnd() < 0.8) {
        await prisma.expenseDayMark.create({ data: { branchId: BRANCH_ID, businessDate: day, markedBy: manager.id } });
      }
    }

    if (dayIdx % 30 === 0) console.log(`  ${toIstYmd(day)}  bills so far ${billSeq}`);
  }

  // ─── Today: the open shift and a bill held for over two hours ───
  const todaySession = await prisma.posSession.findFirst({ where: { businessDate: today, notes: 'DEV' } });
  const heldVariant = pool[0];
  await prisma.heldTransaction.create({
    data: {
      branchId: BRANCH_ID,
      userId: cashier.id,
      cartData: { cart: [{ variantId: heldVariant.id, quantity: 1, price: heldVariant.price }] },
      notes: 'DEV',
      createdAt: new Date(Date.now() - 2.6 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    },
  });

  // ─── Stock on hand, and its arrival for "days in stock" ───
  console.log('Writing stock…');
  for (let i = 0; i < variants.length; i += 2000) {
    const chunk = variants.slice(i, i + 2000);
    await prisma.inventory.createMany({
      data: chunk.map((v) => ({ variantId: v.id, branchId: BRANCH_ID, quantity: Math.max(0, v.onHand) })),
    });
    await prisma.inventoryMovement.createMany({
      data: chunk.map((v) => ({
        variantId: v.id,
        branchId: BRANCH_ID,
        type: 'purchase' as const,
        quantity: Math.max(1, v.onHand),
        createdBy: manager.id,
        createdAt: v.stockIn,
      })),
    });
  }

  // ─── Customer roll-ups ───
  await prisma.$executeRaw`
    UPDATE customers c SET
      "visitCount" = s.n,
      "totalSpent" = s.spent,
      "loyaltyPoints" = FLOOR(s.spent / 100),
      "createdAt" = s.first
    FROM (
      SELECT "customerId", COUNT(*) n, SUM(total) spent, MIN("createdAt") first
      FROM sales WHERE "saleNumber" LIKE 'DEV-%' AND "customerId" IS NOT NULL GROUP BY "customerId"
    ) s
    WHERE c.id = s."customerId"`;

  console.log(
    `Done: ${billSeq} bills, ${returnSeq} returns/exchanges, ${variants.length} variants, ${customers.length} customers. ` +
      `Today's shift ${todaySession ? 'is open' : 'missing'}.`
  );
  console.log('Logins (password admin123): dev.manager@, dev.supervisor@, dev.cashier@, dev.nazia@ …clothingerp.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
